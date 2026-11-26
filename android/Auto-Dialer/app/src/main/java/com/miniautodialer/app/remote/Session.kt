package com.miniautodialer.app.remote

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Founder OS pairing + dialer state that must survive a restart: device token,
 * the pending pair request, the cached config, the call being dialed and an
 * open break. The token never leaves this file except as a Bearer header.
 */
class Session(private val ctx: Context) {
    private val sp = ctx.getSharedPreferences("founder_os", Context.MODE_PRIVATE)

    private val _paired = MutableStateFlow(token != null)
    val paired: StateFlow<Boolean> = _paired

    var baseUrl: String
        get() = sp.getString("base_url", DEFAULT_URL) ?: DEFAULT_URL
        set(v) = sp.edit().putString("base_url", v.trimEnd('/')).apply()

    val token: String? get() = sp.getString("token", null)
    val agentName: String get() = sp.getString("agent", "") ?: ""

    @get:SuppressLint("HardwareIds")
    val deviceId: String
        get() = sp.getString("device_id", null) ?: run {
            val id = (Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: "")
                .ifBlank { java.util.UUID.randomUUID().toString().replace("-", "") }
            sp.edit().putString("device_id", id).apply()
            id
        }

    fun savePaired(token: String, agent: String, telecallerId: String) {
        sp.edit().putString("token", token).putString("agent", agent).putString("telecaller", telecallerId)
            .remove("pair_id").remove("pair_secret").remove("pair_code").apply()
        _paired.value = true
    }

    /** Server revoked the token: back to pairing. The outbox is kept and resent after re-pairing. */
    fun unpair() {
        sp.edit().remove("token").remove("agent").remove("telecaller").apply()
        _paired.value = false
    }

    // ── pair request in progress ────────────────────────────────────────────
    val pairRequestId: String? get() = sp.getString("pair_id", null)
    val pairSecret: String? get() = sp.getString("pair_secret", null)
    val pairCode: String? get() = sp.getString("pair_code", null)
    fun savePairRequest(id: String, secret: String, code: String) =
        sp.edit().putString("pair_id", id).putString("pair_secret", secret).putString("pair_code", code).apply()
    fun clearPairRequest() = sp.edit().remove("pair_id").remove("pair_secret").remove("pair_code").apply()

    // ── cached config ───────────────────────────────────────────────────────
    var configJson: String?
        get() = sp.getString("config", null)
        set(v) = sp.edit().putString("config", v).apply()
    val config: DialerConfig get() = DialerConfig.parse(configJson)

    var lastSyncAt: Long
        get() = sp.getLong("last_sync", 0L)
        set(v) = sp.edit().putLong("last_sync", v).apply()
    var lastSyncError: String?
        get() = sp.getString("last_sync_error", null)
        set(v) = sp.edit().putString("last_sync_error", v).apply()

    /** Phone-dialer call-log entries up to this time are already queued (PhoneCallSync). */
    var phoneLogSince: Long
        get() = sp.getLong("phone_log_since", 0L)
        set(v) = sp.edit().putLong("phone_log_since", v).apply()

    // ── live state reported to the Controller board ─────────────────────────
    var liveState: String
        get() = sp.getString("live_state", "idle") ?: "idle"
        set(v) = sp.edit().putString("live_state", v).apply()
    var liveDetail: String
        get() = sp.getString("live_detail", "") ?: ""
        set(v) = sp.edit().putString("live_detail", v).apply()

    // ── the call being dialed (survives process death between dial and return) ─
    var dialQueueId: String?
        get() = sp.getString("dial_queue", null)
        set(v) = sp.edit().putString("dial_queue", v).apply()
    var dialManual: Boolean
        get() = sp.getBoolean("dial_manual", false)
        set(v) = sp.edit().putBoolean("dial_manual", v).apply()
    var dialActive: Boolean
        get() = sp.getBoolean("dial_active", false)
        set(v) = sp.edit().putBoolean("dial_active", v).apply()
    /** The phone went off-hook for the call being dialed (a SIM picker cancel never does). */
    var dialSawCall: Boolean
        get() = sp.getBoolean("dial_saw_call", false)
        set(v) = sp.edit().putBoolean("dial_saw_call", v).apply()
    /** The agent pressed Start: the loop keeps dialing until a break. */
    var running: Boolean
        get() = sp.getBoolean("running", false)
        set(v) = sp.edit().putBoolean("running", v).apply()

    // ── open break ──────────────────────────────────────────────────────────
    var breakId: String?
        get() = sp.getString("break_id", null)
        set(v) = sp.edit().putString("break_id", v).apply()
    var breakReason: String
        get() = sp.getString("break_reason", "") ?: ""
        set(v) = sp.edit().putString("break_reason", v).apply()
    var breakNote: String
        get() = sp.getString("break_note", "") ?: ""
        set(v) = sp.edit().putString("break_note", v).apply()
    var breakStart: Long
        get() = sp.getLong("break_start", 0L)
        set(v) = sp.edit().putLong("break_start", v).apply()

    companion object {
        /** Founder OS Worker (device routes are token-gated, not cookie-gated). */
        const val DEFAULT_URL = "https://founder-os-worker.connect-bui2.workers.dev"
    }
}
