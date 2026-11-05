package in.brindavan.foundercalls.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.brindavan.foundercalls.FounderCallsApp
import in.brindavan.foundercalls.data.CallEventEntity
import in.brindavan.foundercalls.data.Clock
import in.brindavan.foundercalls.data.Direction
import in.brindavan.foundercalls.data.Numbers

@Composable
fun CallLogScreen(onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val db = (context.applicationContext as FounderCallsApp).container.db
    val calls by db.calls().observeAll().collectAsState(initial = emptyList())

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Call log", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        Hint("${calls.size} events · tap for detail and playback")
        if (calls.isEmpty()) {
            Hint("No calls captured yet.")
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(calls, key = { it.id }) { call ->
                CallRow(call, onClick = { onOpen(call.id) })
            }
        }
    }
}

@Composable
private fun CallRow(call: CallEventEntity, onClick: () -> Unit) {
    SectionCard {
        Column(Modifier.fillMaxWidth().clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (call.direction) {
                        Direction.IN -> "↙ ${call.contactName.ifBlank { Numbers.localLabel(call.numberE164) }}"
                        Direction.OUT -> "↗ ${call.contactName.ifBlank { Numbers.localLabel(call.numberE164) }}"
                        Direction.UNKNOWN -> call.numberE164.ifBlank { "Unknown" }
                    },
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                StatusPill(call.status)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Hint(Clock.istTime(call.attemptAt))
                if (call.durationSec > 0) Hint("${call.durationSec}s")
                when {
                    call.recordingPath != null && call.recordingBytes > 0 -> Hint("🎙 ${call.audioSource ?: ""} · ${call.recordingBytes / 1024} KB")
                    call.audioSource != null -> Hint("🎙 ${call.audioSource} · no audio")
                }
                if (call.userFarSideScore != null) Text("★ ${call.userFarSideScore}/5", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                if (!call.synced) Hint("· pending sync")
            }
        }
    }
}
