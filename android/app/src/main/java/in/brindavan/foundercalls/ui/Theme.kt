package in.brindavan.foundercalls.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Ink = Color(0xFF0F172A)
private val Indigo = Color(0xFF6366F1)
private val IndigoSoft = Color(0xFFE0E7FF)
private val Paper = Color(0xFFF8FAFC)
private val Slate = Color(0xFF475569)

private val dark = darkColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = IndigoSoft,
    background = Ink,
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF151F33),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFFCBD5E1),
    secondary = Color(0xFF22D3EE),
)

private val light = lightColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = IndigoSoft,
    onPrimaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Slate,
    secondary = Color(0xFF0891B2),
)

@Composable
fun FounderCallsTheme(content: @Composable () -> Unit) {
    val scheme = if (isSystemInDarkTheme()) dark else light
    MaterialTheme(colorScheme = scheme, content = content)
}
