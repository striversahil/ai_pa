package com.miniautodialer.app.util

import android.content.Context
import com.miniautodialer.app.MiniDialerApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android does not let apps record calls, so recordings reach Founder OS only
 * when the phone's own recorder saves them. This spots the two usual reasons
 * nothing arrives: no access to audio files, or the recorder is switched off.
 */
object RecordingHealth {
    suspend fun problem(ctx: Context): String? = withContext(Dispatchers.IO) {
        if (!RecordingImporter.canAutoFind(ctx)) {
            return@withContext "Recordings can't be read: allow access to audio files (Settings → Recordings) so calls reach Founder OS with their audio."
        }
        val db = MiniDialerApp.db
        val since = Fmt.startOfToday()
        val connected = db.calls().between(since, System.currentTimeMillis() + 60_000).count { it.durationSec > 0 }
        if (connected < 2) return@withContext null
        val recorded = db.recordings().all().count { it.recordedAt >= since }
        if (recorded > 0) return@withContext null
        "No call recordings found today. Turn on auto call recording in the phone's Phone app (Settings → Record calls → Auto record calls → All calls) so recordings reach Founder OS."
    }
}
