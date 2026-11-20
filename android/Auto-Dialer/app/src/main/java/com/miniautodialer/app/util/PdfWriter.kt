package com.miniautodialer.app.util

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import java.io.OutputStream

/** Simple paginated A4 PDF writer for reports (headings, key/value lines and tables). */
class PdfWriter(private val title: String) {
    private val doc = PdfDocument()
    private val pageW = 595
    private val pageH = 842
    private val margin = 36f
    private var pageNo = 0
    private var page: PdfDocument.Page? = null
    private var y = 0f

    private val titlePaint = Paint().apply { textSize = 18f; typeface = Typeface.DEFAULT_BOLD; color = Color.rgb(15, 118, 110); isAntiAlias = true }
    private val hPaint = Paint().apply { textSize = 13f; typeface = Typeface.DEFAULT_BOLD; color = Color.BLACK; isAntiAlias = true }
    private val text = Paint().apply { textSize = 9.5f; color = Color.BLACK; isAntiAlias = true }
    private val bold = Paint().apply { textSize = 9.5f; typeface = Typeface.DEFAULT_BOLD; color = Color.BLACK; isAntiAlias = true }
    private val grey = Paint().apply { textSize = 8f; color = Color.GRAY; isAntiAlias = true }
    private val line = Paint().apply { color = Color.LTGRAY; strokeWidth = 0.5f }
    private val fill = Paint().apply { color = Color.rgb(230, 244, 242) }

    init { newPage() }

    private fun newPage() {
        page?.let { finishPage(it) }
        pageNo++
        page = doc.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create())
        y = margin
        val c = page!!.canvas
        c.drawText(title, margin, y + 12f, titlePaint)
        y += 26f
    }

    private fun finishPage(p: PdfDocument.Page) {
        p.canvas.drawText("Mini Auto Dialer · page $pageNo", margin, pageH - 18f, grey)
        doc.finishPage(p)
    }

    private fun ensure(h: Float) { if (y + h > pageH - margin) newPage() }

    fun subtitle(s: String) { ensure(14f); page!!.canvas.drawText(s, margin, y + 8f, grey); y += 16f }

    fun heading(s: String) { ensure(28f); y += 8f; page!!.canvas.drawText(s, margin, y + 12f, hPaint); y += 20f }

    fun keyValues(pairs: List<Pair<String, String>>) {
        pairs.forEach { (k, v) ->
            ensure(14f)
            page!!.canvas.drawText(k, margin, y + 10f, text)
            page!!.canvas.drawText(v, margin + 220f, y + 10f, bold)
            y += 14f
        }
    }

    /** weights: relative column widths. */
    fun table(header: List<String>, rows: List<List<String>>, weights: List<Float>) {
        val total = weights.sum()
        val usable = pageW - 2 * margin
        val widths = weights.map { it / total * usable }
        fun drawRow(cells: List<String>, isHeader: Boolean) {
            ensure(15f)
            val c = page!!.canvas
            if (isHeader) c.drawRect(margin, y, pageW - margin, y + 14f, fill)
            var x = margin
            cells.forEachIndexed { i, cell ->
                val w = widths.getOrElse(i) { 40f }
                val p = if (isHeader) bold else text
                c.drawText(fit(cell, w - 4f, p), x + 2f, y + 10f, p)
                x += w
            }
            c.drawLine(margin, y + 14f, pageW - margin, y + 14f, line)
            y += 15f
        }
        drawRow(header, true)
        rows.forEach {
            if (y + 15f > pageH - margin) { newPage(); drawRow(header, true) }
            drawRow(it, false)
        }
        y += 6f
    }

    private fun fit(s: String, w: Float, p: Paint): String {
        val clean = s.replace('\n', ' ')
        if (p.measureText(clean) <= w) return clean
        var end = clean.length
        while (end > 0 && p.measureText(clean.substring(0, end) + "…") > w) end--
        return clean.substring(0, end) + "…"
    }

    fun writeTo(out: OutputStream) {
        page?.let { finishPage(it) }
        page = null
        doc.writeTo(out)
        doc.close()
    }
}
