package in.brindavan.foundercalls.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val ONE_SHOT = "founder-calls-sync"
    private const val HEARTBEAT = "founder-calls-heartbeat"

    private fun constraints(context: Context): Constraints {
        val prefs = (context.applicationContext as in.brindavan.foundercalls.FounderCallsApp).container.prefs
        val wifiOnly = kotlinx.coroutines.runBlocking { kotlinx.coroutines.flow.first(prefs.wifiOnly) }
        return Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .build()
    }

    fun runNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints(context))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONE_SHOT, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints(context))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(HEARTBEAT, ExistingPeriodicWorkPolicy.UPDATE, request)
    }
}
