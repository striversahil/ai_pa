package in.brindavan.foundercalls.sync

import in.brindavan.foundercalls.BuildConfig
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : Exception(message)

@Serializable
data class PairRequest(val code: String, val deviceId: String, val label: String, val appVersion: String)

@Serializable
data class PairResponse(val token: String, val agent: String, val deviceId: String, val loggingOnly: Boolean = false)

@Serializable
data class CallDto(
    val id: String,
    val idempotencyKey: String,
    val direction: String,
    val number: String,
    val contactName: String,
    val attemptAt: String,
    val ringStartAt: String? = null,
    val connectAt: String? = null,
    val endAt: String? = null,
    val status: String,
    val callLogType: Int? = null,
    val durationSec: Int = 0,
    val ringSec: Int = 0,
    val simSlot: Int? = null,
    val audioSource: String? = null,
    val recordingState: String = "none",
    val recordingParts: Int = 0,
    val deviceId: String,
)

@Serializable
data class CallBatch(val calls: List<CallDto>)

@Serializable
data class BatchResponse(val accepted: Int = 0, val duplicates: Int = 0, val errors: List<String> = emptyList())

@Serializable
data class HeartbeatRequest(
    val deviceId: String,
    val appVersion: String = "",
    val consent: Boolean = false,
)

@Serializable
data class HeartbeatResponse(
    val loggingOnly: Boolean = false,
    val maxBytes: Long = 30L * 1024 * 1024,
    val maxMinutes: Int = 60,
    val partMinutes: Int = 10,
    val serverTime: String = "",
)

object ApiClient {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun base(path: String) = BuildConfig.API_BASE.trimEnd('/') + path

    private fun request(token: String?, path: String): Request.Builder {
        val b = Request.Builder().url(base(path))
        if (!token.isNullOrBlank()) b.header("Authorization", "Bearer $token")
        return b
    }

    private fun <T> execute(request: Request, parse: (String) -> T): T {
        http.newCall(request).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, body.ifBlank { "HTTP ${res.code}" })
            return parse(body)
        }
    }

    fun pair(code: String, deviceId: String, label: String): PairResponse {
        val body = json.encodeToString(PairRequest.serializer(), PairRequest(code, deviceId, label, BuildConfig.VERSION_NAME))
        val req = Request.Builder().url(base("/api/android/pair")).post(body.toRequestBody(jsonType)).build()
        return execute(req) { json.decodeFromString(PairResponse.serializer(), it) }
    }

    fun heartbeat(token: String, deviceId: String, appVersion: String = "", consent: Boolean = false): HeartbeatResponse {
        val body = json.encodeToString(HeartbeatRequest.serializer(), HeartbeatRequest(deviceId, appVersion, consent))
        val req = request(token, "/api/android/heartbeat").post(body.toRequestBody(jsonType)).build()
        return execute(req) { json.decodeFromString(HeartbeatResponse.serializer(), it) }
    }

    fun uploadCalls(token: String, calls: List<CallDto>): BatchResponse {
        val body = json.encodeToString(CallBatch.serializer(), CallBatch(calls))
        val req = request(token, "/api/android/calls").post(body.toRequestBody(jsonType)).build()
        return execute(req) { json.decodeFromString(BatchResponse.serializer(), it) }
    }

    fun uploadRecording(token: String, callId: String, part: Int, file: File): Int {
        val req = request(token, "/api/android/recordings/$callId?part=$part")
            .put(file.asRequestBody("audio/mp4".toMediaType()))
            .build()
        return execute(req) { 0 }
    }

    fun markRecordingEmpty(token: String, callId: String) {
        val req = request(token, "/api/android/calls/$callId/recording-empty").post("{}".toRequestBody(jsonType)).build()
        execute(req) { 0 }
    }
}
