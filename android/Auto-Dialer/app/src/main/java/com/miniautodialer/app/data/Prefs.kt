package com.miniautodialer.app.data

import android.content.Context
import android.content.SharedPreferences

class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var seeded: Boolean
        get() = sp.getBoolean("seeded", false)
        set(v) = sp.edit().putBoolean("seeded", v).apply()

    /** Tree URI of the phone's call-recording folder (chosen by the user). */
    var recordingFolder: String?
        get() = sp.getString("rec_folder", null)
        set(v) = sp.edit().putString("rec_folder", v).apply()

    /** Only files modified after this time are picked up by automatic scans. */
    var scanSince: Long
        get() = sp.getLong("scan_since", 0L)
        set(v) = sp.edit().putLong("scan_since", v).apply()

    var lastScanAt: Long
        get() = sp.getLong("last_scan", 0L)
        set(v) = sp.edit().putLong("last_scan", v).apply()

    var autoScan: Boolean
        get() = sp.getBoolean("auto_scan", true)
        set(v) = sp.edit().putBoolean("auto_scan", v).apply()

    /** false = auto scan imports only recordings that match a customer (privacy default). */
    var scanImportAll: Boolean
        get() = sp.getBoolean("scan_all", false)
        set(v) = sp.edit().putBoolean("scan_all", v).apply()

    var pendingOnly: Boolean
        get() = sp.getBoolean("pending_only", true)
        set(v) = sp.edit().putBoolean("pending_only", v).apply()

    var lastCampaignId: Long
        get() = sp.getLong("last_campaign", 0L)
        set(v) = sp.edit().putLong("last_campaign", v).apply()

    /** Also log calls made from the phone's own dialer (read from the call log). */
    var trackDialer: Boolean
        get() = sp.getBoolean("track_dialer", false)
        set(v) = sp.edit().putBoolean("track_dialer", v).apply()

    /** When tracking dialer calls, also add numbers that are not customers yet. */
    var trackUnknown: Boolean
        get() = sp.getBoolean("track_unknown", false)
        set(v) = sp.edit().putBoolean("track_unknown", v).apply()

    /** Call-log entries up to this time have already been processed by the dialer sync. */
    var dialerSyncedTo: Long
        get() = sp.getLong("dialer_synced_to", 0L)
        set(v) = sp.edit().putLong("dialer_synced_to", v).apply()

    /** Calls with a talk time below this are not assumed to be answered; the user picks the outcome. */
    var askBelowSec: Int
        get() = sp.getInt("ask_below_sec", 30)
        set(v) = sp.edit().putInt("ask_below_sec", v).apply()
}
