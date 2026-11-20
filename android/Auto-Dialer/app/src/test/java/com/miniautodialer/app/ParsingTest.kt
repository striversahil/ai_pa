package com.miniautodialer.app

import com.miniautodialer.app.data.CallRecord
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.util.Csv
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.PhoneUtil
import com.miniautodialer.app.util.RecordingImporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ParsingTest {
    private fun t(ms: Long?) = ms?.let { Fmt.isoDateTime(it) }

    @Test fun realmeNames() {
        assertEquals("9810202603", PhoneUtil.key(RecordingImporter.phoneFromName("+919810202603-2606291659-1")!!))
        assertEquals("2026-06-29 16:59", t(RecordingImporter.timeFromName("+919810202603-2606291659-1")))
        assertEquals("7303818509", RecordingImporter.phoneFromName("7303818509-2610071514-1"))
        assertEquals("2026-10-07 15:14", t(RecordingImporter.timeFromName("7303818509-2610071514-1")))
        assertNull(RecordingImporter.phoneFromName("rahul new-2606021410"))
        assertEquals("2026-06-02 14:10", t(RecordingImporter.timeFromName("rahul new-2606021410")))
        assertNull(RecordingImporter.phoneFromName("Spam Alert From Jio-2605251607"))
    }

    @Test fun otherBrands() {
        assertEquals("2024-11-18 14:30", t(RecordingImporter.timeFromName("Call recording John Doe_241118_143005")))
        assertEquals("919876543210", RecordingImporter.phoneFromName("John(+919876543210)_20241118143005"))
        assertEquals("2024-11-18 14:30", t(RecordingImporter.timeFromName("John(+919876543210)_20241118143005")))
    }

    @Test fun phones() {
        assertEquals("9876543210", PhoneUtil.fromCell("9.87654321E9"))
        assertEquals("9876543210", PhoneUtil.fromCell("9876543210.0"))
        assertEquals("9876543210", PhoneUtil.key("+91 98765-43210"))
        assertEquals("9876543210", PhoneUtil.key("09876543210"))
    }

    @Test fun csv() {
        val rows = Csv.parse("Name,Mobile,Company\n\"Shah, Ravi\",9876543210,\"A \"\"B\"\" Ltd\"\r\nX;Y,1,2\n")
        assertEquals(listOf("Shah, Ravi", "9876543210", "A \"B\" Ltd"), rows[1])
        assertEquals(3, rows.size)
        assertEquals(listOf("A;B"), Csv.parse("A;B")[0].let { listOf(it.joinToString(";")) })
    }

    @Test fun outcomeFromTalkTime() {
        assertEquals(Outcome.NOT_ANSWERED, Outcome.suggest(0, 30))
        assertNull(Outcome.suggest(15, 30))          // network announcement after decline: user decides
        assertEquals(Outcome.CONNECTED, Outcome.suggest(45, 30))
        assertEquals(Outcome.CONNECTED, Outcome.suggest(5, 0)) // threshold off
        val k = CallRecord(customerId = 1, campaignId = null, phone = "1", startedAt = 0, durationSec = 15, outcome = "NOT_ANSWERED", connected = true)
        assertEquals(false, k.reached)               // talk time alone never counts as connected
    }

    @Test fun lavaUnisocNames() {
        // Lava / Unisoc AOSP dialer: Music/voicecall/sim<N>-[name-]<number>-voicecall-yyyy-MM-dd_HH.mm.ss.amr
        val a = "sim2-9812345678-voicecall-2026-11-19_12.46.35"
        assertEquals("9812345678", RecordingImporter.phoneFromName(a)) // "sim2" is not part of the number
        assertEquals(Fmt.toMillis(java.time.LocalDateTime.of(2026, 11, 19, 12, 46, 35)), RecordingImporter.timeFromName(a))
        val b = "sim1-Acme Flour Mill, GJ-+919812345670-voicecall-2026-11-18_10.53.45"
        assertEquals("9812345670", PhoneUtil.key(RecordingImporter.phoneFromName(b)!!))
        assertEquals(Fmt.toMillis(java.time.LocalDateTime.of(2026, 11, 18, 10, 53, 45)), RecordingImporter.timeFromName(b))
    }

    @Test fun googlePhoneNames() {
        // Google Phone shares recordings as "record-<unix millis>.m4a": a time, not a phone number
        val g = "record-1763612743731"
        assertEquals(1763612743731L, RecordingImporter.timeFromName(g))
        assertEquals(null, RecordingImporter.phoneFromName(g))
        // a real 10-digit number is still read as a phone number
        assertEquals("9812345678", RecordingImporter.phoneFromName("Call_9812345678_20261119_133000"))
    }
}
