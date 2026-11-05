package in.brindavan.foundercalls.call

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import in.brindavan.foundercalls.FounderCallsApp
import in.brindavan.foundercalls.MainActivity
import in.brindavan.foundercalls.R
import in.brindavan.foundercalls.data.AudioSources
import in.brindavan.foundercalls.data.CallEventEntity
import in.brindavan.foundercalls.data.CallLogReconciler
import in.brindavan.foundercalls.data.CallStatus
import in.brindavan.foundercalls.data.Clock
import in.brindavan.foundercalls.data.Contacts
import in.brindavan.foundercalls.data.Direction
import in.brindavan.foundercalls.data.Numbers
import in.brindavan.foundercalls.data.RecordingAttemptEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

class CallTrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val started = AtomicBoolean(false)
    private var recorder: RecordingManager? = null
    private var recordingSource: String? = null

    private val app get() = application as FounderCallsApp
    private val db get() = app.container.db
    private val prefs get() = app.container.prefs
    private val tokens get() = app.container.tokens

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == null) {
            ensureForeground("Standby", "Call tracking is on")
            return START_STICKY
        }
        when (action) {
            ACTION_ENSURE -> ensureForeground("Standby", "Call tracking is on")
            ACTION_INCOMING -> scope.launch {
                ensureForeground("Incoming call", "Capturing call")
                beginCall(Direction.IN, intent.getStringExtra(EXTRA_NUMBER).orEmpty())
            }
            ACTION_OUTGOING -> scope.launch {
                ensureForeground("Outgoing call", "Capturing call")
                beginCall(Direction.OUT, intent.getStringExtra(EXTRA_NUMBER).orEmpty())
            }
            ACTION_CONNECTED -> scope.launch { onConnected() }
            ACTION_ENDED -> scope.launch { onEnded() }
        }
        return START_STICKY
    }

    private fun ensureForeground(title: String, text: String) {
        val notification = buildNotification(title, text)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else 0
        if (started.compareAndSet(false, true)) {
            ServiceCompat.startForeground(this, NOTIF_ID, notification, type)
        } else {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, notification)
        }
    }

    private suspend fun beginCall(direction: Direction, rawNumber: String) {
        if (CallStateMachine.active != null) {
            if (direction == Direction.OUT) updateDirection(direction, rawNumber)
            return
        }
        val deviceId = prefs.deviceId()
        val number = Numbers.e164(rawNumber)
        val now = System.currentTimeMillis()
        val call = ActiveCall(java.util.UUID.randomUUID().toString(), direction, number, now)
        if (!CallStateMachine.begin(call)) return
        val entity = CallStateMachine.entityFrom(call, deviceId, Clock.istDay(now)).copy(
            contactName = Contacts.nameFor(this, number),
            status = if (direction == Direction.IN) CallStatus.RINGING else CallStatus.DIALING,
        )
        db.calls().insert(entity)
        ensureForeground(
            if (direction == Direction.IN) "Incoming call" else "Calling",
            if (number.isBlank()) "Unknown number" else Numbers.localLabel(number),
        )
    }

    private suspend fun updateDirection(direction: Direction, rawNumber: String) {
        val active = CallStateMachine.active ?: return
        val number = Numbers.e164(rawNumber)
        val row = db.calls().get(active.id) ?: return
        db.calls().update(
            row.copy(
                direction = direction,
                numberE164 = if (number.isBlank()) row.numberE164 else number,
                contactName = row.contactName.ifBlank { Contacts.nameFor(this, number) },
                status = CallStatus.DIALING,
            ),
        )
    }

    private suspend fun onConnected() {
        val active = CallStateMachine.active
        if (active == null) {
            beginCall(Direction.UNKNOWN, "")
        }
        val call = CallStateMachine.active ?: return
        val row = db.calls().get(call.id) ?: return
        if (row.connectAt != null) return
        db.calls().update(row.copy(connectAt = System.currentTimeMillis(), status = CallStatus.CONNECTED))
        ensureForeground("Call connected", if (row.numberE164.isBlank()) "Unknown number" else Numbers.localLabel(row.numberE164))
        if (!tokens.loggingOnly) startRecording(call, row)
    }

    private suspend fun startRecording(call: ActiveCall, row: CallEventEntity) {
        val configured = prefs.testSource.first()
        val sources = if (configured == AudioSources.AUTO) AudioSources.ORDER else listOf(configured)
        val manager = RecordingManager(this, prefs.forceSpeaker.first())
        recorder = manager
        val chosen = manager.startWithFallback(sources, call.id) { source, error ->
            scope.launch {
                db.calls().insertAttempt(
                    RecordingAttemptEntity(
                        callId = call.id,
                        audioSource = source,
                        startedAt = System.currentTimeMillis(),
                        verdict = in.brindavan.foundercalls.data.RecordingVerdict.ERROR,
                        errorText = error,
                    ),
                )
            }
        }
        recordingSource = chosen
        ensureForeground(
            if (chosen != null) "Recording ($chosen)" else "Call connected (no audio)",
            if (row.numberE164.isBlank()) "Unknown number" else Numbers.localLabel(row.numberE164),
        )
    }

    private suspend fun onEnded() {
        val call = CallStateMachine.active
        if (call == null) {
            ensureForeground("Standby", "Call tracking is on")
            stopSelf()
            return
        }
        val row = db.calls().get(call.id)
        val manager = recorder
        recorder = null
        val result = if (manager != null) withContext(Dispatchers.Default) { manager.stop() } else null
        if (result != null && recordingSource != null) {
            db.calls().insertAttempt(
                RecordingAttemptEntity(
                    callId = call.id,
                    audioSource = recordingSource ?: "",
                    startedAt = result.durationMs.let { System.currentTimeMillis() - it },
                    endedAt = System.currentTimeMillis(),
                    bytes = result.bytes,
                    maxAmplitude = result.maxAmplitude,
                    verdict = result.verdict,
                    errorText = result.error,
                ),
            )
        }
        if (row != null) {
            val reconciled = CallLogReconciler.reconcile(this, row.numberE164, row.attemptAt)
            val connectAt = row.connectAt
            val endAt = System.currentTimeMillis()
            val status = when {
                reconciled.matched -> reconciled.status
                connectAt != null -> CallStatus.CONNECTED
                else -> CallStatus.FAILED
            }
            val duration = if (reconciled.matched) reconciled.durationSec else
                if (connectAt != null) ((endAt - connectAt) / 1000).toInt().coerceAtLeast(0) else 0
            db.calls().update(
                row.copy(
                    endAt = endAt,
                    status = status,
                    callLogType = reconciled.type,
                    durationSec = duration,
                    ringSec = if (connectAt != null) ((connectAt - row.attemptAt) / 1000).toInt().coerceAtLeast(0) else 0,
                    recordingPath = result?.path ?: row.recordingPath,
                    recordingBytes = result?.bytes ?: row.recordingBytes,
                    maxAmplitude = result?.maxAmplitude ?: row.maxAmplitude,
                    audioSource = recordingSource ?: row.audioSource,
                    note = if (reconciled.matched) "" else "unmatched",
                ),
            )
        }
        recordingSource = null
        CallStateMachine.clear()
        ensureForeground("Standby", "Call tracking is on")
        stopSelf()
    }

    override fun onDestroy() {
        val manager = recorder
        recorder = null
        if (manager != null) manager.stop()
        scope.cancel()
        started.set(false)
        super.onDestroy()
    }

    private fun buildNotification(title: String, text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createChannels() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        private const val CHANNEL = "call_tracking"
        private const val NOTIF_ID = 42
        const val ACTION_ENSURE = "in.brindavan.foundercalls.ENSURE"
        const val ACTION_INCOMING = "in.brindavan.foundercalls.INCOMING"
        const val ACTION_OUTGOING = "in.brindavan.foundercalls.OUTGOING"
        const val ACTION_CONNECTED = "in.brindavan.foundercalls.CONNECTED"
        const val ACTION_ENDED = "in.brindavan.foundercalls.ENDED"
        const val EXTRA_NUMBER = "number"

        private fun send(context: Context, action: String, number: String? = null) {
            val intent = Intent(context, CallTrackingService::class.java).setAction(action)
            if (number != null) intent.putExtra(EXTRA_NUMBER, number)
            ContextCompat.startForegroundService(context, intent)
        }

        fun ensureRunning(context: Context) = send(context, ACTION_ENSURE)
        fun incoming(context: Context, number: String) = send(context, ACTION_INCOMING, number)
        fun outgoing(context: Context, number: String) = send(context, ACTION_OUTGOING, number)
        fun connected(context: Context) = send(context, ACTION_CONNECTED)
        fun ended(context: Context) = send(context, ACTION_ENDED)

        fun stop(context: Context) {
            context.stopService(Intent(context, CallTrackingService::class.java))
        }
    }
}
