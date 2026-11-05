package in.brindavan.foundercalls.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import in.brindavan.foundercalls.data.Numbers

class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_NEW_OUTGOING_CALL -> {
                val number = Numbers.e164(intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER))
                CallTrackingService.outgoing(context, number)
            }
            TelephonyManager.ACTION_PHONE_STATE_CHANGED -> {
                val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
                when (state) {
                    TelephonyManager.EXTRA_STATE_RINGING -> {
                        @Suppress("DEPRECATION")
                        val number = Numbers.e164(intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER))
                        CallTrackingService.incoming(context, number)
                    }
                    TelephonyManager.EXTRA_STATE_OFFHOOK -> CallTrackingService.connected(context)
                    TelephonyManager.EXTRA_STATE_IDLE -> CallTrackingService.ended(context)
                }
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // Restore tracking (service self-guards on prefs) and the 15-min sync loop.
            try { in.brindavan.foundercalls.sync.SyncScheduler.schedule(context) } catch (_: Exception) {}
            CallTrackingService.ensureRunning(context)
        }
    }
}
