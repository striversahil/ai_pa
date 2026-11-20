package com.miniautodialer.app.util

import android.content.Context
import android.net.Uri
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayInputStream
import java.math.BigDecimal
import java.nio.charset.Charset
import java.util.zip.ZipInputStream

/** Reads CSV / TSV / XLSX into a list of rows (row 0 is usually the header). */
object TableReader {
    fun read(ctx: Context, uri: Uri): List<List<String>> {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalArgumentException("Could not open the file")
        if (bytes.size >= 2 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()) {
            return XlsxReader.read(bytes)
        }
        if (bytes.size >= 4 && bytes[0] == 0xD0.toByte() && bytes[1] == 0xCF.toByte()) {
            throw IllegalArgumentException(
                "Old Excel 97-2003 (.xls) files are not supported. Open it in Excel and use Save As → .xlsx or .csv."
            )
        }
        return Csv.parse(decode(bytes))
    }

    private fun decode(b: ByteArray): String = when {
        b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte() ->
            String(b, 3, b.size - 3, Charsets.UTF_8)
        b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte() -> String(b, 2, b.size - 2, Charsets.UTF_16LE)
        b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte() -> String(b, 2, b.size - 2, Charsets.UTF_16BE)
        else -> {
            val utf8 = String(b, Charsets.UTF_8)
            if (utf8.contains('�')) String(b, Charset.forName("windows-1252")) else utf8
        }
    }
}

object Csv {
    fun parse(text: String): List<List<String>> {
        val firstLine = text.lineSequence().firstOrNull().orEmpty()
        val delim = listOf(',', ';', '\t', '|').maxByOrNull { d -> firstLine.count { it == d } } ?: ','
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val cell = StringBuilder()
        var inQuotes = false
        var i = 0
        while (i < text.length) {
            val ch = text[i]
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') { cell.append('"'); i++ } else inQuotes = false
                } else cell.append(ch)
            } else {
                when (ch) {
                    '"' -> inQuotes = true
                    delim -> { row.add(cell.toString().trim()); cell.setLength(0) }
                    '\r' -> {}
                    '\n' -> {
                        row.add(cell.toString().trim()); cell.setLength(0)
                        if (row.any { it.isNotEmpty() }) rows.add(row)
                        row = ArrayList()
                    }
                    else -> cell.append(ch)
                }
            }
            i++
        }
        row.add(cell.toString().trim())
        if (row.any { it.isNotEmpty() }) rows.add(row)
        return rows
    }

    fun escape(v: String): String =
        if (v.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + v.replace("\"", "\"\"") + "\"" else v

    fun write(rows: List<List<String>>): String =
        rows.joinToString("\r\n") { r -> r.joinToString(",") { escape(it) } } + "\r\n"
}

object XlsxReader {
    fun read(bytes: ByteArray): List<List<String>> {
        val entries = HashMap<String, ByteArray>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            var e = z.nextEntry
            while (e != null) {
                val n = e.name.trimStart('/')
                if (n.startsWith("xl/") && !e.isDirectory) entries[n] = z.readBytes()
                e = z.nextEntry
            }
        }
        val shared = entries["xl/sharedStrings.xml"]?.let { parseShared(it) } ?: emptyList()
        val sheetPath = firstSheetPath(entries)
            ?: entries.keys.filter { it.startsWith("xl/worksheets/sheet") }.sorted().firstOrNull()
            ?: throw IllegalArgumentException("This Excel file has no worksheet")
        val data = entries[sheetPath] ?: throw IllegalArgumentException("Worksheet not found in file")
        return parseSheet(data, shared)
    }

    private fun parser(b: ByteArray): XmlPullParser = Xml.newPullParser().apply {
        setInput(ByteArrayInputStream(b), "UTF-8")
    }

    private fun firstSheetPath(entries: Map<String, ByteArray>): String? {
        val wb = entries["xl/workbook.xml"] ?: return null
        val rels = entries["xl/_rels/workbook.xml.rels"] ?: return null
        var rid: String? = null
        val p = parser(wb)
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT && rid == null) {
            if (ev == XmlPullParser.START_TAG && p.name == "sheet") rid = p.getAttributeValue(null, "r:id")
            ev = p.next()
        }
        if (rid == null) return null
        val rp = parser(rels)
        ev = rp.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            if (ev == XmlPullParser.START_TAG && rp.name == "Relationship" && rp.getAttributeValue(null, "Id") == rid) {
                val target = rp.getAttributeValue(null, "Target") ?: return null
                return if (target.startsWith("/")) target.trimStart('/') else "xl/$target"
            }
            ev = rp.next()
        }
        return null
    }

    private fun parseShared(b: ByteArray): List<String> {
        val out = ArrayList<String>()
        val p = parser(b)
        val sb = StringBuilder()
        var inPhonetic = false
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            when (ev) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "si" -> sb.setLength(0)
                    "rPh" -> inPhonetic = true
                    "t" -> { val t = p.nextText(); if (!inPhonetic) sb.append(t) }
                }
                XmlPullParser.END_TAG -> when (p.name) {
                    "si" -> out.add(sb.toString())
                    "rPh" -> inPhonetic = false
                }
            }
            ev = p.next()
        }
        return out
    }

    private fun colIndex(ref: String): Int {
        var n = 0
        for (ch in ref) {
            if (ch.isLetter()) n = n * 26 + (ch.uppercaseChar() - 'A' + 1) else break
        }
        return n - 1
    }

    private fun parseSheet(b: ByteArray, shared: List<String>): List<List<String>> {
        val rows = ArrayList<List<String>>()
        val p = parser(b)
        var current: MutableMap<Int, String>? = null
        var cellRef: String? = null
        var cellType: String? = null
        var value: String? = null
        val inline = StringBuilder()
        var nextCol = 0
        var ev = p.eventType
        while (ev != XmlPullParser.END_DOCUMENT) {
            when (ev) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "row" -> { current = HashMap(); nextCol = 0 }
                    "c" -> {
                        cellRef = p.getAttributeValue(null, "r")
                        cellType = p.getAttributeValue(null, "t")
                        value = null; inline.setLength(0)
                    }
                    "v" -> value = p.nextText()
                    "t" -> inline.append(p.nextText())
                }
                XmlPullParser.END_TAG -> when (p.name) {
                    "c" -> {
                        val col = cellRef?.let { colIndex(it) }?.takeIf { it >= 0 } ?: nextCol
                        nextCol = col + 1
                        val text = when (cellType) {
                            "s" -> value?.trim()?.toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                            "inlineStr" -> inline.toString()
                            "b" -> if (value == "1") "TRUE" else "FALSE"
                            "str", "e" -> value ?: ""
                            else -> value?.let { numeric(it) } ?: inline.toString()
                        }
                        current?.put(col, text.trim())
                    }
                    "row" -> {
                        val r = current
                        if (r != null && r.values.any { it.isNotEmpty() }) {
                            val max = r.keys.maxOrNull() ?: -1
                            rows.add((0..max).map { r[it] ?: "" })
                        }
                        current = null
                    }
                }
            }
            ev = p.next()
        }
        return rows
    }

    private fun numeric(v: String): String = runCatching {
        val bd = BigDecimal(v.trim())
        val s = bd.stripTrailingZeros()
        if (s.scale() <= 0) s.toBigInteger().toString() else s.toPlainString()
    }.getOrDefault(v)
}
