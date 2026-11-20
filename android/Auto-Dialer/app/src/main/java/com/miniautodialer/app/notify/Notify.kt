package com.miniautodialer.app.notify

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.R
import com.miniautodialer.app.data.FollowUp
import com.miniautodialer.app.data.FuStatus
import com.miniautodialer.app.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object Notifications {
    const val CH_FOLLOWUP = "followups"
    const val EXTRA_CUSTOMER = "open_customer"
    const val EXTRA_CALL_CUSTOMER = "call_customer"
    const val EXTRA_TAB = "open_tab"

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_FOLLOWUP, "Callback reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Reminders for scheduled customer callbacks and follow-ups"
                enableVibration(true)
            }
        )
    }

    fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun showFollowUp(ctx: Context, fu: FollowUp, name: String, phone: String, company: String) {
        if (!canNotify(ctx)) return
        val open = PendingIntent.getActivity(
            ctx, (fu.id * 2).toInt(),
            Intent(ctx, MainActivity::class.java).putExtra(EXTRA_CUSTOMER, fu.customerId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val call = PendingIntent.getActivity(
            ctx, (fu.id * 2 + 1).toInt(),
            Intent(ctx, MainActivity::class.java).putExtra(EXTRA_CALL_CUSTOMER, fu.customerId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val body = buildString {
            append(phone)
            if (company.isNotBlank()) append(" · ").append(company)
            if (fu.note.isNotBlank()) append("\n").append(fu.note)
        }
        val n = NotificationCompat.Builder(ctx, CH_FOLLOWUP)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Callback due: $name")
            .setContentText(body.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Call now", call)
            .addAction(0, "Open", open)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(fu.id.toInt(), n)
        } catch (_: SecurityException) {
        }
    }

    fun cancel(ctx: Context, fuId: Long) = NotificationManagerCompat.from(ctx).cancel(fuId.toInt())
}

object FollowUpScheduler {
    private const val EXTRA_FU = "fu_id"

    private fun pi(ctx: Context, id: Long, create: Boolean): PendingIntent? {
        val flags = PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(
            ctx, id.toInt(), Intent(ctx, AlarmReceiver::class.java).putExtra(EXTRA_FU, id), flags
        )
    }

    fun schedule(ctx: Context, fu: FollowUp) {
        if (fu.status != FuStatus.PENDING) { cancel(ctx, fu.id); return }
        if (fu.dueAt < System.currentTimeMillis() - 60_000) return // already overdue: shown in app, no alarm
        val am = ctx.getSystemService(AlarmManager::class.java)
        val p = pi(ctx, fu.id, true) ?: return
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fu.dueAt, p)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fu.dueAt, p)
            }
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fu.dueAt, p)
        }
    }

    fun cancel(ctx: Context, id: Long) {
        pi(ctx, id, false)?.let { ctx.getSystemService(AlarmManager::class.java).cancel(it); it.cancel() }
        Notifications.cancel(ctx, id)
    }

    suspend fun rescheduleAll(ctx: Context) {
        MiniDialerApp.db.followUps().allPending().forEach { schedule(ctx, it) }
    }

    internal fun idFrom(intent: Intent): Long = intent.getLongExtra(EXTRA_FU, -1)
}

private val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = FollowUpScheduler.idFrom(intent)
        if (id <= 0) return
        val pending = goAsync()
        receiverScope.launch {
            try {
                val db = MiniDialerApp.db
                val fu = db.followUps().get(id)
                if (fu != null && fu.status == FuStatus.PENDING) {
                    val c = db.customers().get(fu.customerId)
                    if (c != null) Notifications.showFollowUp(context, fu, c.name, c.phone, c.company)
                }
            } finally {
                pending.finish()
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        receiverScope.launch {
            try { FollowUpScheduler.rescheduleAll(context) } finally { pending.finish() }
        }
    }
}
