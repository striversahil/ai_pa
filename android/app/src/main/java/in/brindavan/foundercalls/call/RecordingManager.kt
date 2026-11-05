package in.brindavan.foundercalls.call

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import in.brindavan.foundercalls.data.AudioSources
import in.brindavan.foundercalls.data.RecordingVerdict
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

data class RecordingResult(
    val path: String?,
    val bytes: Long,
    val maxAmplitude: Int,
    val durationMs: Long,
    val verdict: RecordingVerdict,
    val error: String = "",
)

class RecordingManager(
    private val context: Context,
    private val forceSpeaker: Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var maxAmplitude = 0
    private var pollJob: Job? = null
    private var previousSpeaker = false
    private var routed = false

    /** Try each source in order; returns the first that starts. */
    fun startWithFallback(sources: List<String>, callId: String, onSourceFailed: (String, String) -> Unit): String? {
        val dir = File(context.filesDir, "recordings").apply { mkdirs() }
        for (source in sources) {
            val target = File(dir, "$callId-${source.lowercase()}.m4a")
            val result = tryStart(source, target)
            if (result == null) {
                onSourceFailed(source, "start failed")
                target.delete()
                continue
            }
            file = target
            startedAt = System.currentTimeMillis()
            maxAmplitude = 0
            if (forceSpeaker) routeSpeaker(true)
            pollJob = scope.launch {
                while (true) {
                    delay(250)
                    val r = recorder ?: break
                    maxAmplitude = maxOf(maxAmplitude, try { r.maxAmplitude } catch (_: Exception) { 0 })
                }
            }
            return source
        }
        return null
    }

    private fun tryStart(source: String, target: File): MediaRecorder? {
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(AudioSources.androidConstant(source))
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(32_000)
            r.setAudioChannels(1)
            r.setOutputFile(target.absolutePath)
            r.setMaxDuration(60 * 60 * 1000)
            r.prepare()
            r.start()
            recorder = r
            r
        } catch (e: Exception) {
            try { r.release() } catch (_: Exception) {}
            recorder = null
            null
        }
    }

    fun stop(): RecordingResult {
        pollJob?.cancel()
        pollJob = null
        val target = file
        val bytesBefore = target?.length() ?: 0L
        var error = ""
        try {
            recorder?.stop()
        } catch (e: Exception) {
            error = e.message ?: "stop failed"
        }
        try { recorder?.release() } catch (_: Exception) {}
        recorder = null
        if (routed) routeSpeaker(false)
        val duration = if (startedAt > 0) System.currentTimeMillis() - startedAt else 0
        startedAt = 0
        val bytes = target?.length() ?: bytesBefore
        val verdict = when {
            error.isNotEmpty() -> RecordingVerdict.ERROR
            bytes <= 0 -> RecordingVerdict.ERROR
            maxAmplitude == 0 -> RecordingVerdict.SILENT
            duration < 2_000 || bytes < 10 * 1024 -> RecordingVerdict.EMPTY
            else -> RecordingVerdict.OK
        }
        val path = if (bytes > 0) target?.absolutePath else null
        file = null
        return RecordingResult(path, bytes, maxAmplitude, duration, verdict, error)
    }

    private fun routeSpeaker(on: Boolean) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        try {
            if (on) {
                previousSpeaker = am.isSpeakerphoneOn
                am.mode = AudioManager.MODE_NORMAL
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    am.availableCommunicationDevices
                        .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                        ?.let { am.setCommunicationDevice(it) }
                }
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = true
                routed = true
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = previousSpeaker
                am.mode = AudioManager.MODE_NORMAL
                routed = false
            }
        } catch (_: Exception) {
            routed = false
        }
    }
}
