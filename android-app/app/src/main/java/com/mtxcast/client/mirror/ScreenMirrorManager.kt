package com.mtxcast.client.mirror

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Handles MediaProjection capture and publishes the stream to the MTXCast WHIP endpoint.
 */
class ScreenMirrorManager(private val context: Context) {

    enum class State {
        IDLE,
        STARTING,
        RUNNING
    }

    private val job = SupervisorJob()
    private val scope = CoroutineScope(job + Dispatchers.IO)
    private val mutex = Mutex()

    private val _state = MutableStateFlow(State.IDLE)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val errors: SharedFlow<String> = _errors.asSharedFlow()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private var eglBase: EglBase? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var videoCapturer: ScreenCapturerAndroid? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var whipResourceUrl: String? = null
    private var activeApiToken: String? = null
    private var iceSdpDeferred: CompletableDeferred<String>? = null

    fun currentState(): State = _state.value

    fun start(serverUrl: String, apiToken: String?, projectionData: Intent) {
        if (_state.value != State.IDLE) {
            return
        }
        if (serverUrl.isBlank()) {
            _errors.tryEmit("Server URL is empty")
            return
        }
        _state.value = State.STARTING
        scope.launch {
            try {
                startInternal(serverUrl, apiToken, projectionData)
                _state.value = State.RUNNING
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to start screen mirroring", t)
                _errors.tryEmit(t.message ?: "Failed to start mirroring")
                cleanup(sendDelete = false)
                _state.value = State.IDLE
            }
        }
    }

    fun stop() {
        if (_state.value == State.IDLE) {
            return
        }
        scope.launch {
            cleanup(sendDelete = true)
            _state.value = State.IDLE
        }
    }

    fun release() {
        scope.launch {
            cleanup(sendDelete = true)
        }.invokeOnCompletion {
            job.cancel()
        }
    }

    private suspend fun startInternal(serverUrl: String, apiToken: String?, projectionData: Intent) {
        mutex.withLock {
            // Start foreground service for Android 14+
            val serviceIntent = Intent(context, ScreenMirrorService::class.java)
            ContextCompat.startForegroundService(context, serviceIntent)
            
            ensurePeerConnectionFactory()
            prepareVideoCapturer(projectionData)
            val pc = createPeerConnection()
            peerConnection = pc
            addTracks()
            negotiateWhip(pc, serverUrl, apiToken)
        }
    }

    private fun ensurePeerConnectionFactory() {
        if (peerConnectionFactory != null) {
            return
        }
        synchronized(factoryLock) {
            if (!factoryInitialized) {
                val initOptions = PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions()
                PeerConnectionFactory.initialize(initOptions)
                factoryInitialized = true
            }
        }

        val egl = EglBase.create()
        eglBase = egl

        val encoderFactory = org.webrtc.DefaultVideoEncoderFactory(
            egl.eglBaseContext,
            /* enableIntelVp8Encoder */ true,
            /* enableH264HighProfile */ true
        )
        val decoderFactory = org.webrtc.DefaultVideoDecoderFactory(egl.eglBaseContext)

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
    }

    private fun prepareVideoCapturer(permissionData: Intent) {
        val factory = peerConnectionFactory ?: throw IllegalStateException("PeerConnectionFactory not initialized")
        val egl = eglBase ?: throw IllegalStateException("EGL context missing")

        val metrics = context.resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val fps = 30

        surfaceTextureHelper = SurfaceTextureHelper.create("ScreenCaptureThread", egl.eglBaseContext)
        videoSource = factory.createVideoSource(true)
        videoCapturer = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
            override fun onStop() {
                Log.w(TAG, "MediaProjection revoked by system")
                _errors.tryEmit("Screen capture permission revoked")
                stop()
            }
        }).apply {
            initialize(surfaceTextureHelper, context.applicationContext, videoSource!!.capturerObserver)
            try {
                startCapture(width, height, fps)
            } catch (e: InterruptedException) {
                throw IllegalStateException("Unable to start screen capture", e)
            }
        }

        videoTrack = factory.createVideoTrack(VIDEO_TRACK_ID, videoSource).apply {
            setEnabled(true)
        }
    }

    private fun createPeerConnection(): PeerConnection {
        val factory = peerConnectionFactory ?: throw IllegalStateException("PeerConnectionFactory not initialized")
        val config = PeerConnection.RTCConfiguration(listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        iceSdpDeferred = CompletableDeferred()

        return factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) {
                // Trickle ICE is not used for WHIP; candidates are embedded in SDP.
            }

            override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) {}

            override fun onSignalingChange(newState: PeerConnection.SignalingState?) {
                Log.d(TAG, "Signaling state: $newState")
            }

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE connection state: $newState")
            }

            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) {}

            override fun onIceConnectionReceivingChange(receiving: Boolean) {
                Log.d(TAG, "ICE connection receiving: $receiving")
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.d(TAG, "Peer connection state: $newState")
            }

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
                if (newState == PeerConnection.IceGatheringState.COMPLETE) {
                    val sdp = peerConnection?.localDescription?.description
                    if (!sdp.isNullOrEmpty()) {
                        iceSdpDeferred?.takeIf { !it.isCompleted }?.complete(sdp)
                    }
                }
            }

            override fun onAddStream(stream: org.webrtc.MediaStream?) {}

            override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}

            override fun onDataChannel(dc: org.webrtc.DataChannel?) {}

            override fun onRenegotiationNeeded() {}

            override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, mediaStreams: Array<out org.webrtc.MediaStream>?) {}
        }) ?: throw IllegalStateException("Unable to create PeerConnection")
    }

    private fun addTracks() {
        val pc = peerConnection ?: return
        videoTrack?.let { track ->
            pc.addTrack(track)
        }
    }

    private suspend fun negotiateWhip(
        pc: PeerConnection,
        serverUrl: String,
        apiToken: String?
    ) {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        val offer = pc.awaitCreateOffer(constraints)
        pc.awaitSetLocalDescription(offer)
        val localSdp = waitForLocalSdp()
        val (answer, resourceUrl) = exchangeSdp(serverUrl, apiToken, localSdp)
        whipResourceUrl = resourceUrl
        activeApiToken = apiToken
        val remoteDescription = SessionDescription(SessionDescription.Type.ANSWER, answer)
        pc.awaitSetRemoteDescription(remoteDescription)
    }

    private suspend fun waitForLocalSdp(): String {
        val deferred = iceSdpDeferred ?: throw IllegalStateException("ICE deferred missing")
        return try {
            withTimeout(SDP_TIMEOUT_MS) {
                deferred.await()
            }
        } catch (timeout: Exception) {
            peerConnection?.localDescription?.description
                ?: throw timeout
        } finally {
            iceSdpDeferred = null
        }
    }

    private suspend fun exchangeSdp(
        serverUrl: String,
        apiToken: String?,
        offerSdp: String
    ): Pair<String, String?> {
        val endpoint = buildWhipEndpoint(serverUrl)
        val body = offerSdp.toRequestBody("application/sdp".toMediaType())
        val requestBuilder = Request.Builder()
            .url(endpoint)
            .post(body)
            .header("Content-Type", "application/sdp")
            .header("Accept", "application/sdp")
            .header("X-Client", "mtxcast-android")

        apiToken?.let {
            requestBuilder.header("X-API-Token", it)
        }

        val response = httpClient.newCall(requestBuilder.build()).execute()
        if (!response.isSuccessful) {
            val errorBody = response.body?.string()
            response.close()
            throw IOException("WHIP offer failed: ${response.code} ${errorBody ?: ""}")
        }

        val answer = response.body?.string() ?: throw IOException("Server returned empty SDP answer")
        val resourceUrl = response.header("Location")
        response.close()
        return answer to resourceUrl
    }

    private suspend fun cleanup(sendDelete: Boolean) {
        mutex.withLock {
            if (sendDelete) {
                sendDeleteRequest()
            }

            // Stop foreground service
            val serviceIntent = Intent(context, ScreenMirrorService::class.java)
            context.stopService(serviceIntent)

            try {
                videoCapturer?.stopCapture()
            } catch (ignored: Exception) {
                Log.w(TAG, "Failed to stop video capturer cleanly", ignored)
            }

            videoCapturer?.dispose()
            videoCapturer = null

            videoTrack?.dispose()
            videoTrack = null

            videoSource?.dispose()
            videoSource = null

            surfaceTextureHelper?.dispose()
            surfaceTextureHelper = null

            peerConnection?.close()
            peerConnection?.dispose()
            peerConnection = null

            peerConnectionFactory?.dispose()
            peerConnectionFactory = null

            eglBase?.release()
            eglBase = null

            iceSdpDeferred?.cancel()
            iceSdpDeferred = null
            whipResourceUrl = null
            activeApiToken = null
        }
    }

    private fun buildWhipEndpoint(serverUrl: String): String {
        val trimmed = serverUrl.trimEnd('/')
        return "$trimmed/whip"
    }

    private suspend fun sendDeleteRequest() {
        val resource = whipResourceUrl ?: return
        val requestBuilder = Request.Builder()
            .url(resource)
            .delete()
        activeApiToken?.let {
            requestBuilder.header("X-API-Token", it)
        }
        val request = requestBuilder.build()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Failed to delete WHIP resource: ${response.code}")
                }
            }
        } catch (e: IOException) {
            Log.w(TAG, "Error deleting WHIP resource", e)
        }
    }

    companion object {
        private const val TAG = "ScreenMirrorManager"
        private const val VIDEO_TRACK_ID = "MTXCAST_SCREEN"
        private const val SDP_TIMEOUT_MS = 15_000L

        @Volatile
        private var factoryInitialized = false
        private val factoryLock = Any()
    }
}

private suspend fun PeerConnection.awaitCreateOffer(constraints: MediaConstraints): SessionDescription =
    kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        this.createOffer(object : org.webrtc.SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) {
                cont.resume(desc) {}
            }

            override fun onSetSuccess() {}

            override fun onCreateFailure(error: String) {
                cont.resumeWithException(IllegalStateException("createOffer failed: $error"))
            }

            override fun onSetFailure(error: String) {}
        }, constraints)
    }

private suspend fun PeerConnection.awaitSetLocalDescription(desc: SessionDescription) =
    kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
        this.setLocalDescription(object : org.webrtc.SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription?) {}

            override fun onSetSuccess() {
                cont.resume(Unit) {}
            }

            override fun onCreateFailure(error: String?) {}

            override fun onSetFailure(error: String) {
                cont.resumeWithException(IllegalStateException("setLocalDescription failed: $error"))
            }
        }, desc)
    }

private suspend fun PeerConnection.awaitSetRemoteDescription(desc: SessionDescription) =
    kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
        this.setRemoteDescription(object : org.webrtc.SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription?) {}

            override fun onSetSuccess() {
                cont.resume(Unit) {}
            }

            override fun onCreateFailure(error: String?) {}

            override fun onSetFailure(error: String) {
                cont.resumeWithException(IllegalStateException("setRemoteDescription failed: $error"))
            }
        }, desc)
    }

