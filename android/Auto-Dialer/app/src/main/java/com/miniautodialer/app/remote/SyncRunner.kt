package com.miniautodialer.app.remote

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.miniautodialer.app.BuildConfig
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Repo
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * One sync pass: send pending calls + breaks with the live state, upload
 * recordings, then pull config and the queue. An item is marked done only
 * when the server lists it as accepted.
 */
object SyncRunner {
    private val lock = Mutex()

    sealed class Result {
        data object Ok : Result()
        data object Offline : Result()
        data object Unpaired : Result()
    }

    suspend fun run(ctx: Context): Result = lock.withLock {
        val session = MiniDialerApp.session
        if (session.token == null) return Result.Unpaired
        val api = Api(session)
        val dao = MiniDialerApp.db.sync()
        try {
            PhoneCallSync.collect(ctx)
            pushCallsAndBreaks(api, dao)
            uploadRecordings(api, dao, ctx)
            session.configJson = api.config().optJSONObject("config")?.toString() ?: session.configJson
            pullQueue(api, dao)
            dao.prune(System.currentTimeMillis() - 14 * 86_400_000L)
            session.lastSyncAt = System.currentTimeMillis()
            session.lastSyncError = null
            Result.Ok
        } catch (e: ApiException) {
            if (e.code == 401) { session.unpair(); return Result.Unpaired }
            session.lastSyncError = e.message
            Result.Offline
        } catch (e: Exception) {
            session.lastSyncError = "No connection"
            Result.Offline
        }
    }

    private suspend fun pushCallsAndBreaks(api: Api, dao: SyncDao) {
        val session = MiniDialerApp.session
        do {
            val callItems = dao.pending("call", 100)
            val breakItems = dao.pending("break", 50)
            val phoneItems = dao.pending("pcall", 100)
            val calls = JSONArray()
            val gone = mutableListOf<String>()
            val byServerId = HashMap<String, String>()
            for (item in callItems) {
                val p = Outbox.callPayload(item)
                if (p == null) { gone += item.id; continue }
                calls.put(p); byServerId[p.getString("id")] = item.id
            }
            // Phone-dialer calls carry their full payload.
            for (item in phoneItems) {
                val p = runCatching { JSONObject(item.payload) }.getOrNull()
                if (p == null) { gone += item.id; continue }
                calls.put(p); byServerId[p.getString("id")] = item.id
            }
            if (gone.isNotEmpty()) dao.mark(gone, "done", "deleted on phone")
            val breaks = JSONArray()
            val breakIds = HashMap<String, String>()
            for (item in breakItems) {
                val p = JSONObject(item.payload)
                breaks.put(p); breakIds[p.getString("id")] = item.id
            }
            val body = JSONObject()
                .put("calls", calls).put("breaks", breaks).put("appVersion", BuildConfig.VERSION_NAME)
                .put("state", JSONObject().put("state", session.liveState).put("detail", session.liveDetail)
                    .put("pendingSync", dao.pendingCountOnce()))
            val res = api.sync(body)
            val settled = gone.size +
                markResult(dao, res.optJSONArray("acceptedCalls"), res.optJSONArray("rejectedCalls"), byServerId) +
                markResult(dao, res.optJSONArray("acceptedBreaks"), res.optJSONArray("rejectedBreaks"), breakIds)
        } while ((callItems.size == 100 || breakItems.size == 50 || phoneItems.size == 100) && settled > 0)
    }

    /** @return how many outbox items this response settled. */
    private suspend fun markResult(dao: SyncDao, accepted: JSONArray?, rejected: JSONArray?, map: Map<String, String>): Int {
        val ok = (0 until (accepted?.length() ?: 0)).mapNotNull { map[accepted!!.getString(it)] }
        if (ok.isNotEmpty()) dao.mark(ok, "done", null)
        var n = ok.size
        for (i in 0 until (rejected?.length() ?: 0)) {
            val r = rejected!!.getJSONObject(i)
            map[r.optString("id")]?.let { dao.mark(listOf(it), "rejected", r.optString("error")); n++ }
        }
        return n
    }

    private suspend fun uploadRecordings(api: Api, dao: SyncDao, ctx: Context) {
        for (item in dao.pending("rec", 5)) {
            val p = JSONObject(item.payload)
            // The call row must exist on the server first. Auto-dialer calls are
            // keyed by local call id; phone-dialer calls carry their server id.
            val phone = p.has("serverId")
            val callOutbox = if (phone) p.getString("outboxId") else "call:${p.getLong("callId")}"
            if (dao.outbox(callOutbox)?.status != "done") continue
            val serverId = if (phone) p.getString("serverId") else Outbox.serverCallId(p.getLong("callId"))
            val rec = MiniDialerApp.db.recordings().get(p.getLong("recordingId"))
            val file = rec?.let { Repo.recordingFile(ctx, it) }
            if (file == null || !file.exists()) { dao.mark(listOf(item.id), "done", "file gone"); continue }
            when (val code = api.uploadRecording(serverId, file)) {
                in 200..299 -> dao.mark(listOf(item.id), "done", null)
                501 -> return // recording storage not enabled on the server yet; retry later
                404, 403, 413 -> dao.mark(listOf(item.id), "rejected", "HTTP $code")
                else -> return
            }
        }
    }

    private suspend fun pullQueue(api: Api, dao: SyncDao) {
        val items = api.queue().optJSONArray("items") ?: JSONArray()
        val fresh = (0 until items.length()).map { i ->
            val o = items.getJSONObject(i)
            QueueItem(
                id = o.getString("id"),
                customerId = o.optString("customerId"),
                mobile = o.optString("mobile"),
                name = o.optString("name"),
                company = o.optString("company"),
                place = listOf(o.optString("district"), o.optString("state")).filter { it.isNotBlank() }.joinToString(", "),
                clientType = o.optString("clientType"),
                source = o.optString("source", "push"),
                attempts = o.optInt("attempts"),
                dueAt = runCatching { java.time.Instant.parse(o.optString("dueAt")).toEpochMilli() }.getOrDefault(0L),
                position = i,
            )
        }
        // Keep rows disposed here until the server stops serving them.
        val keepDone = fresh.filter { dao.queueItem(it.id)?.localStatus == "done" }.map { it.id }.toSet()
        dao.dropQueueExcept(fresh.map { it.id })
        dao.putQueue(fresh.filter { it.id !in keepDone })
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = when (SyncRunner.run(applicationContext)) {
        SyncRunner.Result.Ok, SyncRunner.Result.Unpaired -> Result.success()
        SyncRunner.Result.Offline -> Result.retry()
    }
}

object SyncScheduler {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Sync as soon as there is a network (immediately when online). */
    fun syncSoon(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("fos-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /** Background safety net: every 15 minutes while paired. */
    fun schedulePeriodic(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("fos-sync-periodic", ExistingPeriodicWorkPolicy.KEEP, req)
    }
}
