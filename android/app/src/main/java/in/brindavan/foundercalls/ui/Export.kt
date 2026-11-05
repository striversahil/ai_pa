package in.brindavan.foundercalls.ui

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import in.brindavan.foundercalls.data.AppDatabase
import in.brindavan.foundercalls.data.Clock
import java.io.File

private fun csv(value: String?): String = "\"" + (value ?: "").replace("\"", "\"\"") + "\""

suspend fun exportCsv(context: Context, db: AppDatabase): File {
    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(dir, "founder-calls-${System.currentTimeMillis()}.csv")
    val rows = db.calls().allOnce()
    file.bufferedWriter().use { w ->
        w.appendLine("attempt_at_ist,direction,number,contact,status,duration_sec,ring_sec,call_log_type,audio_source,recording_bytes,max_amplitude,far_side_score,note,device,android")
        for (r in rows) {
            w.appendLine(
                listOf(
                    csv(Clock.istTime(r.attemptAt)),
                    csv(r.direction.name),
                    csv(r.numberE164),
                    csv(r.contactName),
                    csv(r.status.name),
                    r.durationSec.toString(),
                    r.ringSec.toString(),
                    r.callLogType?.toString() ?: "",
                    csv(r.audioSource),
                    r.recordingBytes.toString(),
                    r.maxAmplitude.toString(),
                    r.userFarSideScore?.toString() ?: "",
                    csv(r.note),
                    csv("${Build.MANUFACTURER} ${Build.MODEL}"),
                    csv(Build.VERSION.RELEASE),
                ).joinToString(","),
            )
        }
    }
    return file
}

fun shareCsv(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/csv"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Export POC results"))
}
