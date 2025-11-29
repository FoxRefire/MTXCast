package com.mtxcast.client

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.mtxcast.client.api.ApiClient
import com.mtxcast.client.api.StatusResponse
import com.mtxcast.client.databinding.ActivityMainBinding
import com.mtxcast.client.mirror.ScreenMirrorManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var settingsManager: SettingsManager
    private lateinit var mediaProjectionManager: MediaProjectionManager
    private lateinit var screenMirrorManager: ScreenMirrorManager
    private var apiToken: String? = null
    private var serverUrl: String = "http://127.0.0.1:8080"
    private var statusUpdateJob: kotlinx.coroutines.Job? = null
    private var isUserSeeking = false

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { uploadFile(it) }
    }

    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            startMirrorSession(result.data!!)
        } else {
            Toast.makeText(this, getString(R.string.mirror_permission_denied), Toast.LENGTH_SHORT).show()
            updateMirrorUi(screenMirrorManager.currentState())
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        settingsManager = SettingsManager(this)
        screenMirrorManager = ScreenMirrorManager(applicationContext)
        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        loadSettings()

        setupUI()
        observeMirrorState()
        updateMirrorUi(screenMirrorManager.currentState())
        startStatusUpdates()
    }

    private fun loadSettings() {
        serverUrl = settingsManager.serverUrl
        apiToken = settingsManager.apiToken
        updateMirrorEndpoint()
    }

    private fun setupUI() {
        binding.buttonPlay.setOnClickListener { controlPlay() }
        binding.buttonPause.setOnClickListener { controlPause() }
        binding.buttonStop.setOnClickListener { controlStop() }
        binding.buttonSeek.setOnClickListener { showSeekDialog() }
        binding.buttonPlayUrl.setOnClickListener { showPlayUrlDialog() }
        binding.buttonUpload.setOnClickListener { selectFile() }
        binding.seekBarVolume.setOnSeekBarChangeListener(
            object : android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: android.widget.SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) {
                        val volume = progress / 100.0
                        setVolume(volume)
                    }
                }
                override fun onStartTrackingTouch(seekBar: android.widget.SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: android.widget.SeekBar?) {}
            }
        )
        binding.seekBarPosition.setOnSeekBarChangeListener(
            object : android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: android.widget.SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser && isUserSeeking) {
                        // Update position text while dragging
                        val max = seekBar?.max ?: 1000
                        val duration = binding.seekBarPosition.tag as? Double ?: 0.0
                        if (duration > 0) {
                            val position = (progress.toDouble() / max) * duration
                            binding.textPosition.text = getString(R.string.position) + ": ${formatTime(position.toInt())} / ${formatTime(duration.toInt())}"
                        }
                    }
                }
                
                override fun onStartTrackingTouch(seekBar: android.widget.SeekBar?) {
                    isUserSeeking = true
                }
                
                override fun onStopTrackingTouch(seekBar: android.widget.SeekBar?) {
                    isUserSeeking = false
                    val max = seekBar?.max ?: 1000
                    val duration = binding.seekBarPosition.tag as? Double ?: 0.0
                    if (duration > 0) {
                        val position = (seekBar?.progress?.toDouble() ?: 0.0) / max * duration
                        seek(position)
                    }
                }
            }
        )
        binding.buttonMirror.setOnClickListener { handleMirrorToggle() }
    }

    private fun startStatusUpdates() {
        statusUpdateJob?.cancel()
        statusUpdateJob = lifecycleScope.launch {
            while (true) {
                try {
                    updateStatus()
                    delay(2000) // Update every 2 seconds
                } catch (e: Exception) {
                    delay(5000) // Retry after 5 seconds on error
                }
            }
        }
    }

    private suspend fun updateStatus() {
        try {
            val api = ApiClient.getApi(serverUrl)
            val response = api.getStatus(apiToken)
            if (response.isSuccessful) {
                val status = response.body()!!
                runOnUiThread {
                    displayStatus(status)
                }
            } else {
                runOnUiThread {
                    showError("Failed to get status: ${response.code()}")
                }
            }
        } catch (e: Exception) {
            runOnUiThread {
                showError("Connection error: ${e.message}")
            }
        }
    }

    private fun displayStatus(status: StatusResponse) {
        binding.textStreamType.text = getString(R.string.stream_type) + ": ${status.stream_type}"
        binding.textTitle.text = getString(R.string.title) + ": ${status.title ?: "N/A"}"
        binding.textPlaying.text = if (status.is_playing) {
            getString(R.string.playing)
        } else {
            getString(R.string.paused)
        }

        val volumePercent = (status.volume * 100).toInt()
        binding.seekBarVolume.progress = volumePercent
        binding.textVolume.text = getString(R.string.volume) + ": ${volumePercent}%"

        if (status.position != null && status.duration != null && status.duration!! > 0) {
            val position = status.position!!
            val duration = status.duration!!
            
            // Update position text
            binding.textPosition.text = getString(R.string.position) + ": ${formatTime(position.toInt())} / ${formatTime(duration.toInt())}"
            binding.textPosition.visibility = View.VISIBLE
            
            // Update seek bar only if user is not currently seeking
            if (!isUserSeeking) {
                binding.seekBarPosition.tag = duration
                val max = binding.seekBarPosition.max
                val progress = ((position / duration) * max).toInt().coerceIn(0, max)
                binding.seekBarPosition.progress = progress
            }
            binding.seekBarPosition.visibility = View.VISIBLE
        } else {
            binding.textPosition.visibility = View.GONE
            binding.seekBarPosition.visibility = View.GONE
        }
    }

    private fun formatTime(seconds: Int): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return if (h > 0) {
            String.format("%d:%02d:%02d", h, m, s)
        } else {
            String.format("%d:%02d", m, s)
        }
    }

    private fun controlPlay() {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.play(apiToken)
                if (response.isSuccessful) {
                    Toast.makeText(this@MainActivity, "Playing", Toast.LENGTH_SHORT).show()
                } else {
                    showError("Failed to play: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun controlPause() {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.pause(apiToken)
                if (response.isSuccessful) {
                    Toast.makeText(this@MainActivity, "Paused", Toast.LENGTH_SHORT).show()
                } else {
                    showError("Failed to pause: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun controlStop() {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.stop(apiToken)
                if (response.isSuccessful) {
                    Toast.makeText(this@MainActivity, "Stopped", Toast.LENGTH_SHORT).show()
                } else {
                    showError("Failed to stop: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun setVolume(volume: Double) {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.setVolume(apiToken, com.mtxcast.client.api.VolumeRequest(volume))
                if (!response.isSuccessful) {
                    showError("Failed to set volume: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun showSeekDialog() {
        val input = android.widget.EditText(this)
        input.inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
        input.hint = "Position in seconds"

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.seek))
            .setView(input)
            .setPositiveButton("OK") { _, _ ->
                val position = input.text.toString().toDoubleOrNull()
                if (position != null) {
                    seek(position)
                } else {
                    Toast.makeText(this, "Invalid position", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun seek(position: Double) {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.seek(apiToken, com.mtxcast.client.api.SeekRequest(position))
                if (response.isSuccessful) {
                    Toast.makeText(this@MainActivity, "Seeked to ${position}s", Toast.LENGTH_SHORT).show()
                } else {
                    showError("Failed to seek: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun showPlayUrlDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_play_url, null)
        val urlInput = view.findViewById<android.widget.EditText>(R.id.editUrl)
        val startTimeInput = view.findViewById<android.widget.EditText>(R.id.editStartTime)

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.play_url))
            .setView(view)
            .setPositiveButton("Play") { _, _ ->
                val url = urlInput.text.toString()
                val startTime = startTimeInput.text.toString().toDoubleOrNull() ?: 0.0
                if (url.isNotEmpty()) {
                    playUrl(url, startTime)
                } else {
                    Toast.makeText(this, "URL cannot be empty", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun playUrl(url: String, startTime: Double) {
        lifecycleScope.launch {
            try {
                val api = ApiClient.getApi(serverUrl)
                val response = api.playMetadata(apiToken, com.mtxcast.client.api.MetadataRequest(url, startTime))
                if (response.isSuccessful) {
                    Toast.makeText(this@MainActivity, "Playing: ${response.body()?.title}", Toast.LENGTH_SHORT).show()
                } else {
                    showError("Failed to play URL: ${response.code()}")
                }
            } catch (e: Exception) {
                showError("Error: ${e.message}")
            }
        }
    }

    private fun selectFile() {
        filePickerLauncher.launch("*/*")
    }

    private fun uploadFile(uri: Uri) {
        lifecycleScope.launch {
            try {
                val contentResolver = contentResolver
                val inputStream = contentResolver.openInputStream(uri)
                val fileName = getFileName(uri) ?: "file"
                val fileBytes = inputStream?.readBytes()
                inputStream?.close()

                if (fileBytes != null) {
                    val requestFile = okhttp3.RequestBody.create(
                        "application/octet-stream".toMediaType(),
                        fileBytes
                    )
                    val body = okhttp3.MultipartBody.Part.createFormData("file", fileName, requestFile)
                    val startTime = okhttp3.RequestBody.create(
                        "text/plain".toMediaType(),
                        "0.0"
                    )

                    val api = ApiClient.getApi(serverUrl)
                    val response = api.uploadFile(apiToken, body, startTime)
                    if (response.isSuccessful) {
                        Toast.makeText(this@MainActivity, "File uploaded and playing", Toast.LENGTH_SHORT).show()
                    } else {
                        showError("Failed to upload file: ${response.code()}")
                    }
                }
            } catch (e: Exception) {
                showError("Error uploading file: ${e.message}")
            }
        }
    }

    private fun getFileName(uri: Uri): String? {
        var result: String? = null
        if (uri.scheme == "content") {
            val cursor = contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        result = it.getString(nameIndex)
                    }
                }
            }
        }
        if (result == null) {
            result = uri.path
            val cut = result?.lastIndexOf('/')
            if (cut != null && cut != -1) {
                result = result?.substring(cut + 1)
            }
        }
        return result
    }

    private fun showError(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun observeMirrorState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                screenMirrorManager.state.collectLatest { state ->
                    updateMirrorUi(state)
                }
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                screenMirrorManager.errors.collectLatest { message ->
                    showError("Mirror: $message")
                    updateMirrorUi(screenMirrorManager.currentState())
                }
            }
        }
    }

    private fun handleMirrorToggle() {
        when (screenMirrorManager.currentState()) {
            ScreenMirrorManager.State.IDLE -> requestScreenCapture()
            ScreenMirrorManager.State.STARTING,
            ScreenMirrorManager.State.RUNNING -> screenMirrorManager.stop()
        }
    }

    private fun requestScreenCapture() {
        val intent = mediaProjectionManager.createScreenCaptureIntent()
        screenCaptureLauncher.launch(intent)
    }

    private fun startMirrorSession(permissionData: Intent) {
        if (serverUrl.isBlank()) {
            showError("Server URL cannot be empty")
            return
        }
        screenMirrorManager.start(serverUrl, apiToken, permissionData)
    }

    private fun updateMirrorUi(state: ScreenMirrorManager.State) {
        when (state) {
            ScreenMirrorManager.State.IDLE -> {
                binding.buttonMirror.text = getString(R.string.start_mirroring)
                binding.buttonMirror.isEnabled = true
                binding.textMirrorStatus.text = getString(R.string.mirror_status_idle)
            }
            ScreenMirrorManager.State.STARTING -> {
                binding.buttonMirror.text = getString(R.string.stop_mirroring)
                binding.buttonMirror.isEnabled = false
                binding.textMirrorStatus.text = getString(R.string.mirror_status_starting)
            }
            ScreenMirrorManager.State.RUNNING -> {
                binding.buttonMirror.text = getString(R.string.stop_mirroring)
                binding.buttonMirror.isEnabled = true
                binding.textMirrorStatus.text = getString(R.string.mirror_status_streaming)
            }
        }
    }

    private fun updateMirrorEndpoint() {
        val endpoint = if (serverUrl.isBlank()) {
            "N/A"
        } else {
            serverUrl.trimEnd('/') + "/whip"
        }
        binding.textMirrorEndpoint.text = getString(R.string.mirror_endpoint_label, endpoint)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.menu_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    override fun onResume() {
        super.onResume()
        loadSettings()
        startStatusUpdates()
    }

    override fun onPause() {
        super.onPause()
        statusUpdateJob?.cancel()
    }

    override fun onDestroy() {
        super.onDestroy()
        screenMirrorManager.release()
    }
}
