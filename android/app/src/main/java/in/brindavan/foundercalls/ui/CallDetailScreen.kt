package in.brindavan.foundercalls.ui

import android.media.MediaPlayer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.brindavan.foundercalls.FounderCallsApp
import in.brindavan.foundercalls.data.CallEventEntity
import in.brindavan.foundercalls.data.Clock
import in.brindavan.foundercalls.data.RecordingAttemptEntity
import java.io.File
import kotlinx.coroutines.launch

@Composable
fun CallDetailScreen(id: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val db = (context.applicationContext as FounderCallsApp).container.db
    val scope = rememberCoroutineScope()
    var call by remember { mutableStateOf<CallEventEntity?>(null) }
    var attempts by remember { mutableStateOf<List<RecordingAttemptEntity>>(emptyList()) }
    var score by remember { mutableStateOf<Int?>(null) }
    var note by remember { mutableStateOf("") }

    LaunchedEffect(id) {
        call = db.calls().get(id)
        attempts = db.calls().attemptsFor(id)
        score = call?.userFarSideScore
        note = call?.note ?: ""
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Call detail", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            TextButton(onClick = onBack) { Text("Back") }
        }
        val c = call
        if (c == null) {
            Hint("Loading…")
            return@Column
        }
        SectionCard {
            Text(c.numberE164.ifBlank { "Unknown number" }, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            if (c.contactName.isNotBlank()) Hint(c.contactName)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { StatusPill(c.status); Hint(Clock.istTime(c.attemptAt)) }
            Text("direction ${c.direction} · ring ${c.ringSec}s · talk ${c.durationSec}s", fontSize = 12.sp)
            Text("callLogType ${c.callLogType ?: "—"} · ${if (c.synced) "synced" else "local only"}", fontSize = 12.sp)
            if (c.note.isNotBlank()) Hint(c.note)
        }
        if (c.recordingPath != null && c.recordingBytes > 0) {
            SectionCard(title = "Audio (${c.audioSource})") { AudioPlayer(c.recordingPath) }
        } else {
            SectionCard(title = "Audio") { Hint("No usable audio for this call.") }
        }
        SectionCard(title = "Far-side score") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (n in 1..5) {
                    OutlinedButton(onClick = { score = n }, modifier = Modifier.weight(1f)) {
                        Text(if (score == n) "★$n" else "$n")
                    }
                }
            }
            Hint("1 = inaudible, 3 = usable, 5 = clear.")
            OutlinedTextField(note, { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth())
            Button(
                onClick = {
                    val updated = c.copy(userFarSideScore = score, note = note.take(500))
                    scope.launch {
                        db.calls().update(updated)
                        call = updated
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save score") }
        }
        SectionCard(title = "Recording attempts") {
            if (attempts.isEmpty()) Hint("No attempts recorded.")
            for (a in attempts) {
                Text("${a.audioSource} · ${a.verdict ?: "started"} · ${a.bytes} B · amp ${a.maxAmplitude}", fontSize = 12.sp)
                if (a.errorText.isNotBlank()) Hint(a.errorText)
            }
        }
    }
}

@Composable
private fun AudioPlayer(path: String) {
    var playing by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    DisposableEffect(path) {
        onDispose { player?.release(); player = null }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = {
            if (playing) {
                player?.pause(); playing = false
            } else {
                if (player == null && File(path).exists()) {
                    player = MediaPlayer().apply { setDataSource(path); prepare() }
                    player?.setOnCompletionListener { playing = false }
                }
                player?.start(); playing = true
            }
        }) { Text(if (playing) "Pause" else "Play") }
        OutlinedButton(onClick = { player?.seekTo(0) }) { Text("Restart") }
    }
}

