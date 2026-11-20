package com.miniautodialer.app

import android.app.Application
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import com.miniautodialer.app.data.AppDatabase
import com.miniautodialer.app.data.Prefs
import com.miniautodialer.app.data.Repo
import com.miniautodialer.app.notify.FollowUpScheduler
import com.miniautodialer.app.notify.Notifications
import com.miniautodialer.app.remote.Session
import com.miniautodialer.app.remote.SyncScheduler
import com.miniautodialer.app.util.RecordingImporter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MiniDialerApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var scanJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Notifications.createChannels(this)
        appScope.launch {
            Repo.seedIfNeeded(this@MiniDialerApp)
            FollowUpScheduler.rescheduleAll(this@MiniDialerApp)
        }
        if (session.token != null) {
            SyncScheduler.schedulePeriodic(this)
            SyncScheduler.syncSoon(this)
        }
        watchNewRecordings()
    }

    /**
     * Picks up a call recording as soon as the phone's recorder saves it, whatever folder it uses:
     * Android's media index announces every new audio file. Works while the app's process is alive;
     * the scans on app open and after each call cover the rest.
     */
    private fun watchNewRecordings() {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                if (!prefs.autoScan || !RecordingImporter.hasAudioAccess(this@MiniDialerApp)) return
                // a recorder writes the file in several steps; wait until it is finished
                scanJob?.cancel()
                scanJob = appScope.launch {
                    delay(8_000)
                    RecordingImporter.scan(this@MiniDialerApp)
                }
            }
        }
        runCatching {
            contentResolver.registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer)
        }
    }

    companion object {
        lateinit var instance: MiniDialerApp
            private set
        val db: AppDatabase get() = AppDatabase.get(instance)
        val prefs: Prefs by lazy { Prefs(instance) }
        val session: Session by lazy { Session(instance) }
    }
}
