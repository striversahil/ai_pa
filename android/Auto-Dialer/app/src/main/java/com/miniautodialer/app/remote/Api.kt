package com.miniautodialer.app.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String) : Exception(message)

/** Tiny JSON client for the Founder OS device routes (no extra libraries). */
class Api(private val session: Session) {

    private suspend fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = (URL(session.baseUrl + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("Accept", "application/json")
                if (auth) session.token?.let { setRequestProperty("Authorization", "Bearer $it") }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            try {
                body?.let { b -> conn.outputStream.use { it.write(b.toString().toByteArray()) } }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
                if (code !in 200..299) throw ApiException(code, json.optString("error", "HTTP $code"))
                json
            } finally {
                conn.disconnect()
            }
        }

    suspend fun pairRequest(agentName: String, label: String, appVersion: String): JSONObject =
        request("POST", "/api/android/pair-request", JSONObject()
            .put("deviceId", session.deviceId).put("agentName", agentName).put("label", label).put("appVersion", appVersion), auth = false)

    suspend fun pairStatus(requestId: String, secret: String): JSONObject =
        request("POST", "/api/android/pair-status", JSONObject().put("requestId", requestId).put("secret", secret), auth = false)

    suspend fun config(): JSONObject = request("GET", "/api/android/dialer/config")

    suspend fun queue(): JSONObject = request("GET", "/api/android/dialer/queue?limit=100")

    suspend fun sync(body: JSONObject): JSONObject = request("POST", "/api/android/dialer/sync", body)

    /** One recording part. 501 = storage not enabled on the server yet (kept for later). */
    /** Real audio type from the recorder's file extension (mirror: backend device-calls/types.ts recordingFormat). */
    private fun audioType(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "amr" -> "audio/amr"
        "3gp", "3gpp" -> "audio/3gpp"
        "mp3" -> "audio/mpeg"
        "ogg", "oga" -> "audio/ogg"
        "opus" -> "audio/opus"
        "wav" -> "audio/wav"
        "aac" -> "audio/aac"
        "webm" -> "audio/webm"
        else -> "audio/mp4" // m4a / mp4 / unknown
    }

    suspend fun uploadRecording(serverCallId: String, file: File): Int = withContext(Dispatchers.IO) {
        val conn = (URL("${session.baseUrl}/api/android/recordings/$serverCallId?part=0").openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 120_000
            setFixedLengthStreamingMode(file.length())
            setRequestProperty("Content-Type", audioType(file.name))
            session.token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            conn.outputStream.use { out -> file.inputStream().use { it.copyTo(out) } }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }
}
