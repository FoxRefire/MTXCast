package com.mtxcast.client.api

import retrofit2.Response
import retrofit2.http.*

interface MTXCastApi {
    @GET("/status")
    suspend fun getStatus(
        @Header("X-API-Token") apiToken: String? = null
    ): Response<StatusResponse>

    @POST("/control/play")
    suspend fun play(
        @Header("X-API-Token") apiToken: String? = null
    ): Response<ControlResponse>

    @POST("/control/pause")
    suspend fun pause(
        @Header("X-API-Token") apiToken: String? = null
    ): Response<ControlResponse>

    @POST("/control/stop")
    suspend fun stop(
        @Header("X-API-Token") apiToken: String? = null
    ): Response<ControlResponse>

    @POST("/control/seek")
    suspend fun seek(
        @Header("X-API-Token") apiToken: String? = null,
        @Body body: SeekRequest
    ): Response<SeekResponse>

    @POST("/control/volume")
    suspend fun setVolume(
        @Header("X-API-Token") apiToken: String? = null,
        @Body body: VolumeRequest
    ): Response<VolumeResponse>

    @POST("/metadata")
    suspend fun playMetadata(
        @Header("X-API-Token") apiToken: String? = null,
        @Body body: MetadataRequest
    ): Response<MetadataResponse>

    @Multipart
    @POST("/upload")
    suspend fun uploadFile(
        @Header("X-API-Token") apiToken: String? = null,
        @Part file: okhttp3.MultipartBody.Part,
        @Part("start_time") startTime: okhttp3.RequestBody
    ): Response<UploadResponse>
}

data class StatusResponse(
    val stream_type: String,
    val title: String?,
    val is_playing: Boolean,
    val volume: Double,
    val position: Double?,
    val duration: Double?,
    val is_seekable: Boolean?
)

data class ControlResponse(
    val is_playing: Boolean?,
    val stream_type: String?
)

data class SeekRequest(
    val position: Double
)

data class SeekResponse(
    val position: Double,
    val stream_type: String
)

data class VolumeRequest(
    val volume: Double
)

data class VolumeResponse(
    val volume: Double
)

data class MetadataRequest(
    val source_url: String,
    val start_time: Double = 0.0
)

data class MetadataResponse(
    val stream_type: String,
    val title: String?,
    val is_playing: Boolean
)

data class UploadResponse(
    val stream_type: String,
    val title: String?,
    val is_playing: Boolean,
    val file_path: String?
)
