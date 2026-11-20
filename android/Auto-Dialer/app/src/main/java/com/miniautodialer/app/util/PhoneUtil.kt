package com.miniautodialer.app.util

import java.math.BigDecimal

object PhoneUtil {
    /** Keeps a leading + and digits only. */
    fun clean(raw: String): String {
        val t = raw.trim()
        val digits = t.filter { it.isDigit() }
        return if (t.startsWith("+") && digits.isNotEmpty()) "+$digits" else digits
    }

    /** Matching key: last 10 digits (drops country code / trunk 0). */
    fun key(raw: String): String {
        val d = raw.filter { it.isDigit() }
        return if (d.length > 10) d.takeLast(10) else d
    }

    fun isValid(raw: String): Boolean = raw.count { it.isDigit() } >= 5

    /** Excel often stores mobile numbers as numbers: 9.87654321E9 or 9876543210.0 */
    fun fromCell(v: String): String {
        val t = v.trim()
        if (t.isEmpty()) return t
        if (Regex("^[0-9.]+[eE][+]?[0-9]+$").matches(t) || Regex("^[0-9]+\\.0+$").matches(t)) {
            return runCatching { BigDecimal(t).toBigInteger().toString() }.getOrDefault(t)
        }
        return t
    }

    fun sameNumber(a: String, b: String): Boolean {
        val ka = key(a)
        val kb = key(b)
        return ka.isNotEmpty() && ka == kb
    }
}
