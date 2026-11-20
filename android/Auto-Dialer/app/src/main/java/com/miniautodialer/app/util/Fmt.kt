package com.miniautodialer.app.util

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

object Fmt {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val dateF = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault())
    private val timeF = DateTimeFormatter.ofPattern("hh:mm a", Locale.getDefault())
    private val dateTimeF = DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a", Locale.getDefault())
    private val isoDate = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val isoDateTime = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    fun ldt(ms: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), zone)
    fun date(ms: Long): String = ldt(ms).format(dateF)
    fun time(ms: Long): String = ldt(ms).format(timeF)
    fun dateTime(ms: Long): String = ldt(ms).format(dateTimeF)
    fun isoDate(ms: Long): String = ldt(ms).format(isoDate)
    fun isoDateTime(ms: Long): String = ldt(ms).format(isoDateTime)

    /** "Today, 04:30 PM" / "Tomorrow, ..." / full date. */
    fun friendly(ms: Long): String {
        val d = ldt(ms).toLocalDate()
        val today = LocalDate.now(zone)
        val prefix = when (d) {
            today -> "Today"
            today.plusDays(1) -> "Tomorrow"
            today.minusDays(1) -> "Yesterday"
            else -> d.format(dateF)
        }
        return "$prefix, ${time(ms)}"
    }

    fun duration(sec: Int): String {
        if (sec <= 0) return "0s"
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return when {
            h > 0 -> "%dh %02dm %02ds".format(h, m, s)
            m > 0 -> "%dm %02ds".format(m, s)
            else -> "${s}s"
        }
    }

    fun clock(ms: Long): String {
        val total = (ms / 1000).toInt()
        return "%d:%02d".format(total / 60, total % 60)
    }

    fun size(bytes: Long): String = when {
        bytes >= 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
        bytes >= 1024 -> "%d KB".format(bytes / 1024)
        else -> "$bytes B"
    }

    fun startOfDay(d: LocalDate): Long = d.atStartOfDay(zone).toInstant().toEpochMilli()
    fun startOfToday(): Long = startOfDay(LocalDate.now(zone))
    fun startOfTomorrow(): Long = startOfDay(LocalDate.now(zone).plusDays(1))
    fun toMillis(dt: LocalDateTime): Long = dt.atZone(zone).toInstant().toEpochMilli()
    fun today(): LocalDate = LocalDate.now(zone)
    fun weekStart(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
}
