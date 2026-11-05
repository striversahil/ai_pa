package in.brindavan.foundercalls.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import in.brindavan.foundercalls.FounderCallsApp
import in.brindavan.foundercalls.data.CallEventEntity
import java.io.File
import java.time.Instant

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as FounderCallsApp
        val tokens = app.container.tokens
        val token = tokens.token ?: return Result.success()
        val db = app.container.db

        return try {
            val deviceId = app.container.prefs.deviceId()
            val consent = try { kotlinx.coroutines.flow.first(app.container.prefs.consentAccepted) } catch (_: Exception) { false }
            val heartbeat = ApiClient.heartbeat(token, deviceId, in.brindavan.foundercalls.BuildConfig.VERSION_NAME, consent)
            tokens.loggingOnly = heartbeat.loggingOnly

            val pending = db.calls().unsynced(200)
            if (pending.isNotEmpty()) {
                val response = ApiClient.uploadCalls(token, pending.map { it.toDto() })
                if (response.accepted + response.duplicates >= pending.size) {
                    for (call in pending) db.calls().update(call.copy(synced = true))
                } else {
                    val acceptedIds = pending.take(response.accepted + response.duplicates).map { it.id }.toSet()
                    for (call in pending) if (call.id in acceptedIds) db.calls().update(call.copy(synced = true))
                }
            }

            val recordings = db.calls().pendingRecordings(20)
            for (call in recordings) {
                val bytes = call.recordingBytes
                if (bytes <= 0 || call.recordingPath == null) {
                    ApiClient.markRecordingEmpty(token, call.id)
                    db.calls().update(call.copy(recordingUploaded = true))
                    continue
                }
                val file = File(call.recordingPath)
                if (!file.exists()) {
                    ApiClient.markRecordingEmpty(token, call.id)
                    db.calls().update(call.copy(recordingUploaded = true))
                    continue
                }
                if (file.length() > heartbeat.maxBytes) {
                    ApiClient.markRecordingEmpty(token, call.id)
                    db.calls().update(call.copy(recordingUploaded = true))
                    continue
                }
                ApiClient.uploadRecording(token, call.id, 0, file)
                db.calls().update(call.copy(recordingUploaded = true, recordingParts = 1))
            }
            purgeOld(db)
            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401) tokens.clear()
            if (e.status in 400..499 && e.status != 429) Result.success() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun CallEventEntity.toDto(): CallDto = CallDto(
        id = id,
        idempotencyKey = "$deviceId|$attemptAt|$numberE164",
        direction = direction.name,
        number = numberE164,
        contactName = contactName,
        attemptAt = Instant.ofEpochMilli(attemptAt).toString(),
        ringStartAt = ringStartAt?.let { Instant.ofEpochMilli(it).toString() },
        connectAt = connectAt?.let { Instant.ofEpochMilli(it).toString() },
        endAt = endAt?.let { Instant.ofEpochMilli(it).toString() },
        status = status.name,
        callLogType = callLogType,
        durationSec = durationSec,
        ringSec = ringSec,
        simSlot = simSlot,
        audioSource = audioSource,
        recordingState = when {
            recordingPath != null && recordingBytes > 0 -> "pending"
            recordingPath != null -> "empty"
            else -> "none"
        },
        recordingParts = if (recordingPath != null) 1 else 0,
        deviceId = deviceId,
    )

    /** 7-day offline queue + storage caps: delete ACKed audio, drop old rows, cap at ~500 MB. */
    private suspend fun purgeOld(db: in.brindavan.foundercalls.data.AppDatabase) {
        try {
            val cutoff = System.currentTimeMillis() - 7L * 24 * 3600_000
            val old = db.calls().purgeable(cutoff)
            for (row in old) {
                try { row.recordingPath?.let { File(it).delete() } } catch (_: Exception) {}
            }
            if (old.isNotEmpty()) db.calls().purgeSyncedOlderThan(cutoff)
            db.calls().purgeOrphanAttempts()
            // 500 MB local cap: delete oldest synced audio files until under budget.
            val dir = File(applicationContext.filesDir, "recordings")
            if (dir.exists()) {
                val files = dir.listFiles()?.sortedBy { it.lastModified() } ?: emptyList()
                var total = files.sumOf { it.length() }
                for (f in files) {
                    if (total <= 500L * 1024 * 1024) break
                    try {
                        val n = f.length()
                        if (f.delete()) total -= n
                    } catch (_: Exception) {}
                }
            }
        } catch (_: Exception) {}
    }
}
