package com.miniautodialer.app.ui

import android.media.MediaPlayer
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.miniautodialer.app.data.Customer
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.util.Fmt
import kotlinx.coroutines.delay
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset

val Brand = Color(0xFF0F766E)
val CallGreen = Color(0xFF16A34A)

@Composable
fun MiniDialerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Brand,
            onPrimary = Color.White,
            primaryContainer = Color(0xFFCCFBF1),
            onPrimaryContainer = Color(0xFF042F2E),
            secondary = Color(0xFF2563EB),
            secondaryContainer = Color(0xFFDBEAFE),
            surface = Color(0xFFFAFAFA),
            background = Color(0xFFFAFAFA),
            surfaceVariant = Color(0xFFEFF3F3),
        ),
        content = content
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppScaffold(
    title: String,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    fab: @Composable () -> Unit = {},
    topLevel: Boolean = false,
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                },
                navigationIcon = {
                    if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                actions = actions,
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Brand, titleContentColor = Color.White,
                    navigationIconContentColor = Color.White, actionIconContentColor = Color.White
                )
            )
        },
        floatingActionButton = fab,
        contentWindowInsets = if (topLevel) WindowInsets(0) else WindowInsets.navigationBars,
    ) { p -> Box(Modifier.imePadding()) { content(p) } }
}

@Composable
fun OutcomeBadge(outcomeName: String?, modifier: Modifier = Modifier) {
    val o = Outcome.of(outcomeName)
    if (o == null) {
        // Founder OS dispositions that are not built-in outcomes (e.g. NOT_DISPOSED)
        if (!outcomeName.isNullOrBlank()) SmallBadge(outcomeName.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }, Color(0xFF64748B))
        return
    }
    Text(
        o.label,
        color = Color.White,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier.background(o.color, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp)
    )
}

@Composable
fun SmallBadge(text: String, color: Color) {
    Text(
        text, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.background(color, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp)
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleSmall, color = Brand, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
fun StatCard(label: String, value: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Card(
        modifier = modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(1.dp)
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).background(color.copy(alpha = 0.12f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(label, style = MaterialTheme.typography.bodySmall, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(icon, null, tint = Color.LightGray, modifier = Modifier.size(64.dp))
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
        if (action != null) { Spacer(Modifier.height(12.dp)); action() }
    }
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String = "Delete", onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun TextInputDialog(title: String, initial: String = "", label: String = "", confirm: String = "Save", onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var v by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(v, { v = it }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { if (v.isNotBlank()) { onConfirm(v.trim()); onDismiss() } }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value, onChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Filled.Search, null) },
        trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, "Clear") } },
        singleLine = true,
        shape = RoundedCornerShape(28.dp)
    )
}

/** Date + time picker with quick presets. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimePickerDialog(initial: Long, onDismiss: () -> Unit, onPicked: (Long) -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    val init = Fmt.ldt(initial)
    val dateState = rememberDatePickerState(
        initialSelectedDateMillis = init.toLocalDate().atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
    )
    val timeState = rememberTimePickerState(init.hour, init.minute, false)
    if (step == 0) {
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = { TextButton(onClick = { step = 1 }) { Text("Next") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
        ) { DatePicker(dateState) }
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Select time") },
            text = { TimePicker(timeState) },
            confirmButton = {
                TextButton(onClick = {
                    val d = Instant.ofEpochMilli(dateState.selectedDateMillis ?: initial).atZone(ZoneOffset.UTC).toLocalDate()
                    onPicked(Fmt.toMillis(LocalDateTime.of(d, LocalTime.of(timeState.hour, timeState.minute))))
                    onDismiss()
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Back") } }
        )
    }
}

/** Quick callback presets. */
fun callbackPresets(): List<Pair<String, Long>> {
    val now = LocalDateTime.now()
    val tomorrow10 = now.toLocalDate().plusDays(1).atTime(10, 0)
    return listOf(
        "In 1 hour" to Fmt.toMillis(now.plusHours(1).withSecond(0).withNano(0)),
        "This evening" to Fmt.toMillis(now.toLocalDate().atTime(18, 0)).let { if (it < System.currentTimeMillis()) Fmt.toMillis(now.plusHours(3)) else it },
        "Tomorrow 10 AM" to Fmt.toMillis(tomorrow10),
        "In 2 days" to Fmt.toMillis(tomorrow10.plusDays(1)),
        "Next week" to Fmt.toMillis(tomorrow10.plusDays(6)),
    )
}

@Composable
fun CustomerPickerDialog(customers: List<Customer>, onDismiss: () -> Unit, onPick: (Customer) -> Unit) {
    var q by remember { mutableStateOf("") }
    val filtered = remember(q, customers) {
        if (q.isBlank()) customers else customers.filter { it.name.contains(q, true) || it.phone.contains(q) || it.company.contains(q, true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Select customer") },
        text = {
            Column {
                SearchField(q, { q = it }, "Name or number")
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(filtered.take(200), key = { it.id }) { c ->
                        ListItem(
                            headlineContent = { Text(c.name) },
                            supportingContent = { Text(c.phone + if (c.company.isNotBlank()) " · ${c.company}" else "") },
                            modifier = Modifier.clickable { onPick(c); onDismiss() }
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

/** Inline audio player for a recording file. */
@Composable
fun AudioPlayer(file: File, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var player by remember(file) { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember(file) { mutableStateOf(false) }
    var pos by remember(file) { mutableIntStateOf(0) }
    var dur by remember(file) { mutableIntStateOf(0) }
    var speed by remember(file) { mutableFloatStateOf(1f) }

    DisposableEffect(file) {
        val mp = try {
            MediaPlayer().apply {
                setDataSource(file.absolutePath)
                prepare()
                setOnCompletionListener { playing = false; pos = 0; seekTo(0) }
            }
        } catch (e: Exception) {
            Toast.makeText(ctx, "Cannot play this file: ${e.message}", Toast.LENGTH_SHORT).show()
            null
        }
        player = mp
        dur = mp?.duration ?: 0
        onDispose { mp?.release(); player = null }
    }
    LaunchedEffect(playing) {
        while (playing) {
            player?.let { pos = it.currentPosition }
            delay(250)
        }
    }
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilledIconButton(onClick = {
                val p = player ?: return@FilledIconButton
                if (p.isPlaying) { p.pause(); playing = false } else { p.start(); playing = true }
            }) { Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pause" else "Play") }
            Slider(
                value = if (dur > 0) pos.toFloat() / dur else 0f,
                onValueChange = { f -> pos = (f * dur).toInt(); player?.seekTo(pos) },
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp)
            )
            TextButton(onClick = {
                speed = when (speed) { 1f -> 1.5f; 1.5f -> 2f; else -> 1f }
                player?.let { p ->
                    val wasPlaying = p.isPlaying
                    runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) }
                    if (!wasPlaying) runCatching { p.pause() }
                }
            }) { Text("${speed}x") }
        }
        Text("${Fmt.clock(pos.toLong())} / ${Fmt.clock(dur.toLong())}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
    }
}

@Composable
fun InfoCard(text: String, icon: ImageVector = Icons.Filled.Info, color: Color = Color(0xFF2563EB), action: (@Composable () -> Unit)? = null) {
    Card(colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.08f)), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, null, tint = color)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(text, style = MaterialTheme.typography.bodyMedium)
                if (action != null) action()
            }
        }
    }
}

@Composable
fun LabeledValue(label: String, value: String) {
    if (value.isBlank()) return
    Row(Modifier.padding(vertical = 2.dp)) {
        Text("$label: ", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
