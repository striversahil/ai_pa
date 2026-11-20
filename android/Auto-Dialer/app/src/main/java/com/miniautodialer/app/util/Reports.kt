package com.miniautodialer.app.util

import android.content.Context
import android.net.Uri
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.CallRecord
import com.miniautodialer.app.data.CallRow
import com.miniautodialer.app.data.FuStatus
import com.miniautodialer.app.data.Outcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.DateTimeFormatter

enum class PeriodType(val label: String) { DAILY("Daily"), WEEKLY("Weekly"), MONTHLY("Monthly") }

data class Period(val type: PeriodType, val start: LocalDate) {
    val end: LocalDate
        get() = when (type) {
            PeriodType.DAILY -> start.plusDays(1)
            PeriodType.WEEKLY -> start.plusWeeks(1)
            PeriodType.MONTHLY -> start.plusMonths(1)
        }
    val fromMs get() = Fmt.startOfDay(start)
    val toMs get() = Fmt.startOfDay(end) - 1

    fun shift(n: Long) = copy(
        start = when (type) {
            PeriodType.DAILY -> start.plusDays(n)
            PeriodType.WEEKLY -> start.plusWeeks(n)
            PeriodType.MONTHLY -> start.plusMonths(n)
        }
    )

    fun label(): String {
        val f = DateTimeFormatter.ofPattern("dd MMM yyyy")
        return when (type) {
            PeriodType.DAILY -> start.format(f)
            PeriodType.WEEKLY -> "${start.format(DateTimeFormatter.ofPattern("dd MMM"))} – ${end.minusDays(1).format(f)}"
            PeriodType.MONTHLY -> start.format(DateTimeFormatter.ofPattern("MMMM yyyy"))
        }
    }

    companion object {
        fun current(type: PeriodType): Period {
            val t = Fmt.today()
            return when (type) {
                PeriodType.DAILY -> Period(type, t)
                PeriodType.WEEKLY -> Period(type, Fmt.weekStart(t))
                PeriodType.MONTHLY -> Period(type, t.withDayOfMonth(1))
            }
        }
    }
}

data class DayStat(val date: LocalDate, val calls: Int, val connected: Int, val durationSec: Int, val interested: Int)

data class Summary(
    val calls: Int,
    val connected: Int,
    val durationSec: Int,
    val uniqueCustomers: Int,
    val byOutcome: Map<Outcome, Int>,
    val byDay: List<DayStat>,
    val byCampaign: List<Pair<String, Int>>,
) {
    val connectRate: Int get() = if (calls == 0) 0 else connected * 100 / calls
    val avgDuration: Int get() = if (connected == 0) 0 else durationSec / connected

    companion object {
        fun of(calls: List<CallRecord>, campaignNames: Map<Long, String> = emptyMap()): Summary {
            val connected = calls.filter { it.reached }
            return Summary(
                calls = calls.size,
                connected = connected.size,
                durationSec = connected.sumOf { it.durationSec },
                uniqueCustomers = calls.map { it.customerId }.distinct().size,
                byOutcome = Outcome.entries.associateWith { o -> calls.count { it.outcome == o.name } },
                byDay = calls.groupBy { Fmt.ldt(it.startedAt).toLocalDate() }.toSortedMap().map { (d, l) ->
                    DayStat(d, l.size, l.count { it.reached }, l.filter { it.reached }.sumOf { it.durationSec },
                        l.count { it.outcome == Outcome.INTERESTED.name })
                },
                byCampaign = calls.groupBy { it.campaignId }.map { (id, l) ->
                    (id?.let { campaignNames[it] } ?: "No list (direct calls)") to l.size
                }.sortedByDescending { it.second },
            )
        }
    }
}

enum class ExportFormat(val ext: String, val mime: String) {
    XLSX("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    CSV("csv", "text/csv"),
    PDF("pdf", "application/pdf"),
}

object Exporter {
    private val CALL_HEADER = listOf("Date", "Time", "Customer", "Phone", "Company", "Calling List", "Outcome", "Duration (sec)", "Duration", "Remarks")

    private fun callRow(r: CallRow): List<Any?> = listOf(
        Fmt.isoDate(r.call.startedAt), Fmt.time(r.call.startedAt), r.customerName ?: "", r.call.phone, r.company ?: "",
        r.campaignName ?: "", Outcome.of(r.call.outcome)?.label ?: r.call.outcome, r.call.durationSec,
        Fmt.duration(r.call.durationSec), r.call.remarks,
    )

    private fun summaryRows(s: Summary): List<List<Any?>> = buildList {
        add(listOf("Metric", "Value"))
        add(listOf("Total calls", s.calls))
        add(listOf("Connected calls", s.connected))
        add(listOf("Connect rate %", s.connectRate))
        add(listOf("Unique customers called", s.uniqueCustomers))
        add(listOf("Total connected duration", Fmt.duration(s.durationSec)))
        add(listOf("Average connected call", Fmt.duration(s.avgDuration)))
        Outcome.entries.forEach { add(listOf(it.label, s.byOutcome[it] ?: 0)) }
    }

    suspend fun exportReport(ctx: Context, uri: Uri, period: Period, fmt: ExportFormat): String = withContext(Dispatchers.IO) {
        val db = MiniDialerApp.db
        val rows = db.calls().rowsInRange(period.fromMs, period.toMs)
        val names = db.campaigns().allOnce().associate { it.id to it.name }
        val s = Summary.of(rows.map { it.call }, names)
        val title = "${period.type.label} Calling Report — ${period.label()}"
        ctx.contentResolver.openOutputStream(uri)?.use { os ->
            when (fmt) {
                ExportFormat.CSV -> os.write(("﻿" + Csv.write(listOf(CALL_HEADER) + rows.map { r -> callRow(r).map { it?.toString() ?: "" } })).toByteArray())
                ExportFormat.XLSX -> XlsxWriter.write(
                    os, listOf(
                        Sheet("Summary", listOf(listOf(title, "")) + summaryRows(s)),
                        Sheet("By Day", listOf(listOf("Date", "Calls", "Connected", "Interested", "Connected duration")) +
                            s.byDay.map { listOf(it.date.toString(), it.calls, it.connected, it.interested, Fmt.duration(it.durationSec)) }),
                        Sheet("By Calling List", listOf(listOf("Calling list", "Calls")) + s.byCampaign.map { listOf(it.first, it.second) }),
                        Sheet("Calls", listOf(CALL_HEADER) + rows.map { callRow(it) }),
                    )
                )
                ExportFormat.PDF -> PdfWriter(title).apply {
                    subtitle("Generated ${Fmt.dateTime(System.currentTimeMillis())}")
                    heading("Summary")
                    keyValues(summaryRows(s).drop(1).map { it[0].toString() to it[1].toString() })
                    if (s.byDay.size > 1) {
                        heading("By day")
                        table(listOf("Date", "Calls", "Connected", "Interested", "Duration"),
                            s.byDay.map { listOf(Fmt.date(Fmt.startOfDay(it.date)), "${it.calls}", "${it.connected}", "${it.interested}", Fmt.duration(it.durationSec)) },
                            listOf(3f, 1.5f, 1.5f, 1.5f, 2f))
                    }
                    if (s.byCampaign.isNotEmpty()) {
                        heading("By calling list")
                        table(listOf("Calling list", "Calls"), s.byCampaign.map { listOf(it.first, "${it.second}") }, listOf(5f, 1f))
                    }
                    heading("Call details")
                    table(listOf("Date/Time", "Customer", "Phone", "Outcome", "Dur.", "Remarks"),
                        rows.map { r -> listOf(Fmt.isoDateTime(r.call.startedAt), r.customerName ?: "", r.call.phone,
                            Outcome.of(r.call.outcome)?.label ?: r.call.outcome, Fmt.duration(r.call.durationSec), r.call.remarks) },
                        listOf(2.3f, 2.5f, 2.2f, 2.2f, 1.3f, 3.5f))
                }.writeTo(os)
            }
        } ?: throw IllegalStateException("Cannot write file")
        "Report exported (${rows.size} calls)"
    }

    /** Exports every customer with full call history and follow-ups. campaignId limits it to one calling list. */
    suspend fun exportCustomers(ctx: Context, uri: Uri, fmt: ExportFormat, campaignId: Long? = null): String = withContext(Dispatchers.IO) {
        val db = MiniDialerApp.db
        val customers = if (campaignId == null) db.customers().all() else db.campaigns().membersOnce(campaignId).map { it.customer }
        val ids = customers.map { it.id }.toSet()
        val calls = (if (campaignId == null) db.calls().rowsInRange(0, Long.MAX_VALUE) else db.calls().rowsForCampaign(campaignId))
            .filter { it.call.customerId in ids }
        val byCustomer = calls.groupBy { it.call.customerId }
        val pendingFu = db.followUps().allPending().groupBy { it.customerId }
        val recCount = db.recordings().all().groupBy { it.customerId }
        val custHeader = listOf("Name", "Mobile", "Company", "Email", "Location", "Category", "Remarks", "Total calls",
            "Connected calls", "Last outcome", "Last call", "Next follow-up", "Follow-up note", "Recordings")
        val custRows = customers.map { c ->
            val l = byCustomer[c.id].orEmpty()
            val last = l.maxByOrNull { it.call.startedAt }
            val next = pendingFu[c.id]?.minByOrNull { it.dueAt }
            listOf<Any?>(c.name, c.phone, c.company, c.email, c.location, c.category, c.remarks, l.size,
                l.count { it.call.reached }, last?.let { Outcome.of(it.call.outcome)?.label } ?: "",
                last?.let { Fmt.isoDateTime(it.call.startedAt) } ?: "", next?.let { Fmt.isoDateTime(it.dueAt) } ?: "",
                next?.note ?: "", recCount[c.id]?.size ?: 0)
        }
        ctx.contentResolver.openOutputStream(uri)?.use { os ->
            when (fmt) {
                ExportFormat.CSV -> os.write(("﻿" + Csv.write(listOf(CALL_HEADER) + calls.map { r -> callRow(r).map { it?.toString() ?: "" } })).toByteArray())
                ExportFormat.XLSX -> XlsxWriter.write(os, listOf(
                    Sheet("Customers", listOf(custHeader) + custRows),
                    Sheet("Call History", listOf(CALL_HEADER) + calls.map { callRow(it) }),
                ))
                ExportFormat.PDF -> PdfWriter("Customer Calling History").apply {
                    subtitle("Generated ${Fmt.dateTime(System.currentTimeMillis())} · ${customers.size} customers · ${calls.size} calls")
                    customers.forEach { c ->
                        val l = byCustomer[c.id].orEmpty()
                        if (l.isEmpty()) return@forEach
                        heading("${c.name} · ${c.phone}" + if (c.company.isNotBlank()) " · ${c.company}" else "")
                        table(listOf("Date/Time", "Outcome", "Duration", "Remarks"),
                            l.sortedBy { it.call.startedAt }.map { r -> listOf(Fmt.isoDateTime(r.call.startedAt),
                                Outcome.of(r.call.outcome)?.label ?: "", Fmt.duration(r.call.durationSec), r.call.remarks) },
                            listOf(2.2f, 2.2f, 1.4f, 6f))
                    }
                }.writeTo(os)
            }
        } ?: throw IllegalStateException("Cannot write file")
        "Exported ${customers.size} customers, ${calls.size} calls"
    }

    @Suppress("unused")
    private fun isPending(s: String) = s == FuStatus.PENDING
}
