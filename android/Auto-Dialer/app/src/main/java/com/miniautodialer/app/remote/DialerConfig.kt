package com.miniautodialer.app.remote

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime
import java.time.ZoneId

// mirror: founder-os_backend/src/modules/dialer/types.ts — same names, same defaults.

data class Disposition(val key: String, val label: String, val connected: Boolean, val retry: Boolean, val callback: Boolean)

data class BreakReason(val key: String, val label: String, val maxMin: Int, val needsNote: Boolean)

/** Sales-head scheduled break (IST HH:MM). The server sends only this agent's. The dialer is locked inside it. */
data class ScheduledBreak(val id: String, val label: String, val start: String, val end: String)

data class DialerConfig(
    val dispositionSec: Int = 20,
    val nextCallSec: Int = 3,
    val shiftStart: String = "09:00",
    val shiftEnd: String = "21:00",
    val retryGapMin: Int = 120,
    val retryMax: Int = 3,
    val dispositions: List<Disposition> = DEFAULT_DISPOSITIONS,
    val breakReasons: List<BreakReason> = DEFAULT_BREAKS,
    val scheduledBreaks: List<ScheduledBreak> = emptyList(),
    /** Report calls made/received in the phone's own dialer (call log). */
    val trackPhoneCalls: Boolean = true,
    val updatedAt: String = "",
) {
    fun disposition(key: String?): Disposition? = dispositions.firstOrNull { it.key == key }

    /** Inside the shift window (IST)? Outside it the dialer is locked. */
    fun inShift(now: LocalTime = LocalTime.now(IST)): Boolean = runCatching {
        !now.isBefore(LocalTime.parse(shiftStart)) && now.isBefore(LocalTime.parse(shiftEnd))
    }.getOrDefault(true)

    /** The scheduled break running now (IST), if any. */
    fun activeScheduledBreak(now: LocalTime = LocalTime.now(IST)): ScheduledBreak? = scheduledBreaks.firstOrNull { b ->
        runCatching { !now.isBefore(LocalTime.parse(b.start)) && now.isBefore(LocalTime.parse(b.end)) }.getOrDefault(false)
    }

    companion object {
        val IST: ZoneId = ZoneId.of("Asia/Kolkata")
        const val NOT_DISPOSED = "NOT_DISPOSED"
        const val NOT_ANSWERED = "NOT_ANSWERED"

        val DEFAULT_DISPOSITIONS = listOf(
            Disposition("CONNECTED", "Connected", true, false, false),
            Disposition("INTERESTED", "Interested", true, false, false),
            Disposition("NOT_INTERESTED", "Not Interested", true, false, false),
            Disposition("CALLBACK", "Callback Required", true, false, true),
            Disposition("FOLLOW_UP", "Follow-up Required", true, false, true),
            Disposition("BUSY", "Busy", false, true, false),
            Disposition("NOT_ANSWERED", "Not Answered", false, true, false),
            Disposition("REJECTED", "Rejected", false, true, false),
            Disposition("WRONG_NUMBER", "Wrong Number", false, false, false),
            Disposition("FAILED", "Call Failed", false, true, false),
        )
        val DEFAULT_BREAKS = listOf(
            BreakReason("LUNCH", "Lunch", 30, false),
            BreakReason("TEA", "Tea", 15, false),
            BreakReason("MEETING", "Meeting", 0, false),
            BreakReason("TRAINING", "Training", 0, false),
            BreakReason("WASHROOM", "Washroom", 10, false),
            BreakReason("SYSTEM", "System issue", 0, true),
            BreakReason("OTHER", "Other", 0, true),
        )

        fun parse(json: String?): DialerConfig {
            if (json.isNullOrBlank()) return DialerConfig()
            return runCatching {
                val o = JSONObject(json)
                DialerConfig(
                    dispositionSec = o.optInt("dispositionSec", 20),
                    nextCallSec = o.optInt("nextCallSec", 3),
                    shiftStart = o.optString("shiftStart", "09:00"),
                    shiftEnd = o.optString("shiftEnd", "21:00"),
                    retryGapMin = o.optInt("retryGapMin", 120),
                    retryMax = o.optInt("retryMax", 3),
                    dispositions = o.optJSONArray("dispositions").map {
                        Disposition(it.getString("key"), it.getString("label"), it.optBoolean("connected"), it.optBoolean("retry"), it.optBoolean("callback"))
                    }.ifEmpty { DEFAULT_DISPOSITIONS },
                    breakReasons = o.optJSONArray("breakReasons").map {
                        BreakReason(it.getString("key"), it.getString("label"), it.optInt("maxMin"), it.optBoolean("needsNote"))
                    }.ifEmpty { DEFAULT_BREAKS },
                    scheduledBreaks = o.optJSONArray("scheduledBreaks").map {
                        ScheduledBreak(it.optString("id"), it.optString("label", "Break"), it.getString("start"), it.getString("end"))
                    },
                    trackPhoneCalls = o.optBoolean("trackPhoneCalls", true),
                    updatedAt = o.optString("updatedAt", ""),
                )
            }.getOrDefault(DialerConfig())
        }

        private fun <T> JSONArray?.map(f: (JSONObject) -> T): List<T> =
            if (this == null) emptyList() else (0 until length()).mapNotNull { i -> runCatching { f(getJSONObject(i)) }.getOrNull() }
    }
}
