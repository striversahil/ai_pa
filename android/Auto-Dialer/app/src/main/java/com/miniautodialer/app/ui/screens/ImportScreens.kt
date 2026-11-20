package com.miniautodialer.app.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.PhoneUtil
import com.miniautodialer.app.util.TableReader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class Field(val label: String, val keys: List<String>) {
    NAME("Customer name *", listOf("name", "customer", "contact person", "client", "party")),
    PHONE("Mobile number *", listOf("mobile", "phone", "number", "contact", "mob", "cell", "whatsapp", "tel")),
    COMPANY("Company", listOf("company", "firm", "business", "organisation", "organization", "shop")),
    EMAIL("Email", listOf("email", "e-mail", "mail")),
    LOCATION("Location", listOf("location", "city", "address", "area", "place", "state", "district", "town")),
    CATEGORY("Category", listOf("category", "type", "group", "segment", "class")),
    REMARKS("Remarks", listOf("remark", "note", "comment", "description")),
}

private fun looksPhone(s: String) = s.count { it.isDigit() } >= 7 && s.all { it.isDigit() || it in "+-() .eE" }

private fun autoMap(header: List<String>?, rows: List<List<String>>): Map<Field, Int> {
    val map = HashMap<Field, Int>()
    val used = HashSet<Int>()
    if (header != null) {
        val h = header.map { it.lowercase().trim() }
        // exact-ish passes first so "Company Name" goes to COMPANY not NAME
        for (f in listOf(Field.EMAIL, Field.COMPANY, Field.PHONE, Field.LOCATION, Field.CATEGORY, Field.REMARKS, Field.NAME)) {
            val idx = h.indices.firstOrNull { i -> i !in used && f.keys.any { k -> h[i].contains(k) } }
            if (idx != null) { map[f] = idx; used += idx }
        }
    }
    val cols = rows.maxOfOrNull { it.size } ?: 0
    val sample = rows.take(30)
    if (Field.PHONE !in map) {
        (0 until cols).filter { it !in used }.maxByOrNull { c -> sample.count { looksPhone(it.getOrNull(c).orEmpty()) } }
            ?.takeIf { c -> sample.count { looksPhone(it.getOrNull(c).orEmpty()) } > sample.size / 2 }
            ?.let { map[Field.PHONE] = it; used += it }
    }
    if (Field.NAME !in map) {
        (0 until cols).firstOrNull { c -> c !in used && sample.count { it.getOrNull(c).orEmpty().any(Char::isLetter) } > sample.size / 2 }
            ?.let { map[Field.NAME] = it }
    }
    return map
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(nav: NavHostController, campaignId: Long) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var raw by remember { mutableStateOf<List<List<String>>?>(null) }
    var fileName by remember { mutableStateOf("") }
    var hasHeader by remember { mutableStateOf(true) }
    var mapping by remember { mutableStateOf<Map<Field, Int>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var overwrite by remember { mutableStateOf(false) }
    var target by remember { mutableLongStateOf(campaignId) }  // 0 none, -1 new
    var newListName by remember { mutableStateOf("") }
    val campaigns by MiniDialerApp.db.campaigns().all().collectAsState(emptyList())

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true; error = null
        scope.launch {
            try {
                val rows = withContext(Dispatchers.IO) { TableReader.read(ctx, uri) }
                if (rows.isEmpty()) throw IllegalArgumentException("The file is empty")
                fileName = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
                val header = rows.first()
                val headerMap = autoMap(header, rows.drop(1))
                hasHeader = header.none { looksPhone(it) } && headerMap.isNotEmpty()
                raw = rows
                mapping = if (hasHeader) headerMap else autoMap(null, rows)
            } catch (e: Exception) {
                error = e.message ?: "Could not read the file"
            }
            busy = false
        }
    }

    val rows = raw
    val header = rows?.let { r -> if (hasHeader) r.first() else List(r.maxOf { it.size }) { "Column ${'A' + it}" } }
    val data = rows?.let { if (hasHeader) it.drop(1) else it }.orEmpty()

    AppScaffold(title = "Import customers", onBack = { nav.popBackStack() }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            InfoCard("Choose an Excel (.xlsx) or CSV file. The first sheet is used. Columns like Name, Mobile, Company, Email, City, Category and Remarks are detected automatically. Duplicate numbers are merged, not duplicated.")
            Spacer(Modifier.height(12.dp))
            Button(onClick = {
                picker.launch(arrayOf(
                    "text/csv", "text/comma-separated-values", "text/plain", "text/tab-separated-values",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
                    "application/octet-stream", "application/csv"
                ))
            }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.UploadFile, null); Spacer(Modifier.width(8.dp)); Text(if (rows == null) "Choose file" else "Choose another file")
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            error?.let { Text(it, color = Color(0xFFDC2626), modifier = Modifier.padding(top = 8.dp)) }
            if (rows != null && header != null) {
                SectionTitle("$fileName · ${data.size} rows")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(hasHeader, {
                        hasHeader = it
                        mapping = if (it) autoMap(rows.first(), rows.drop(1)) else autoMap(null, rows)
                    })
                    Text("First row contains column names")
                }
                SectionTitle("Match columns")
                Field.entries.forEach { f ->
                    var open by remember { mutableStateOf(false) }
                    ExposedDropdownMenuBox(open, { open = it }, Modifier.padding(vertical = 4.dp)) {
                        OutlinedTextField(
                            value = mapping[f]?.let { header.getOrNull(it) } ?: "— not in file —",
                            onValueChange = {}, readOnly = true, label = { Text(f.label) },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        )
                        ExposedDropdownMenu(open, { open = false }) {
                            DropdownMenuItem(text = { Text("— not in file —") }, onClick = { mapping = mapping - f; open = false })
                            header.forEachIndexed { i, h ->
                                DropdownMenuItem(text = { Text(h.ifBlank { "Column ${'A' + i}" }) }, onClick = { mapping = mapping + (f to i); open = false })
                            }
                        }
                    }
                }
                SectionTitle("Preview")
                Column(Modifier.horizontalScroll(rememberScrollState())) {
                    data.take(5).forEach { r ->
                        Text(
                            listOf(Field.NAME, Field.PHONE, Field.COMPANY, Field.LOCATION).joinToString("  |  ") { f -> mapping[f]?.let { r.getOrNull(it) } ?: "-" },
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                SectionTitle("Add to calling list")
                var open by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(open, { open = it }) {
                    OutlinedTextField(
                        value = when (target) { 0L -> "Don't add to a list"; -1L -> "Create new list…"; else -> campaigns.firstOrNull { it.id == target }?.name ?: "" },
                        onValueChange = {}, readOnly = true, label = { Text("Calling list") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    )
                    ExposedDropdownMenu(open, { open = false }) {
                        DropdownMenuItem(text = { Text("Don't add to a list") }, onClick = { target = 0; open = false })
                        campaigns.forEach { c -> DropdownMenuItem(text = { Text(c.name) }, onClick = { target = c.id; open = false }) }
                        DropdownMenuItem(text = { Text("Create new list…") }, onClick = { target = -1; open = false })
                    }
                }
                if (target == -1L) OutlinedTextField(newListName, { newListName = it }, label = { Text("New list name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(overwrite, { overwrite = it })
                    Text("Overwrite details of existing customers", style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        val phoneCol = mapping[Field.PHONE] ?: run { error = "Select the column that contains the mobile number"; return@Button }
                        if (target == -1L && newListName.isBlank()) { error = "Enter a name for the new list"; return@Button }
                        busy = true; error = null
                        scope.launch {
                            val cid = when (target) {
                                0L -> null
                                -1L -> MiniDialerApp.db.campaigns().insert(Campaign(name = newListName.trim()))
                                else -> target
                            }
                            fun col(r: List<String>, f: Field) = mapping[f]?.let { r.getOrNull(it) }.orEmpty()
                            val items = data.map { r ->
                                ImportRow(col(r, Field.NAME), r.getOrNull(phoneCol).orEmpty(), col(r, Field.COMPANY), col(r, Field.EMAIL),
                                    col(r, Field.LOCATION), col(r, Field.CATEGORY), col(r, Field.REMARKS))
                            }
                            val res = Repo.importCustomers(items, cid, overwrite)
                            busy = false
                            Toast.makeText(ctx, "Added ${res.added}, updated ${res.updated}, skipped ${res.skipped}" +
                                if (cid != null) ", ${res.linked} added to list" else "", Toast.LENGTH_LONG).show()
                            if (cid != null && campaignId == 0L) { nav.popBackStack(); nav.navigate("campaign/$cid") } else nav.popBackStack()
                        }
                    },
                    enabled = !busy && data.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) { Text("Import ${data.size} rows") }
            }
        }
    }
}

private data class PhoneContact(val name: String, val phone: String, val key: String)

private fun loadContacts(ctx: Context): List<PhoneContact> {
    val out = LinkedHashMap<String, PhoneContact>()
    ctx.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
        null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC"
    )?.use { c ->
        while (c.moveToNext()) {
            val name = c.getString(0) ?: ""
            val num = c.getString(1) ?: continue
            val clean = PhoneUtil.clean(num)
            if (!PhoneUtil.isValid(clean)) continue
            val key = PhoneUtil.key(clean)
            if (key !in out) out[key] = PhoneContact(name.ifBlank { clean }, clean, key)
        }
    }
    return out.values.toList()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsImportScreen(nav: NavHostController, campaignId: Long) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var contacts by remember { mutableStateOf<List<PhoneContact>?>(null) }
    var q by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<String>() }
    var target by remember { mutableLongStateOf(campaignId) }
    var busy by remember { mutableStateOf(false) }
    val campaigns by MiniDialerApp.db.campaigns().all().collectAsState(emptyList())

    LaunchedEffect(granted) {
        if (!granted) perm.launch(Manifest.permission.READ_CONTACTS)
        else contacts = withContext(Dispatchers.IO) { loadContacts(ctx) }
    }
    val shown = contacts.orEmpty().filter { q.isBlank() || it.name.contains(q, true) || it.phone.contains(q) }

    AppScaffold(title = "Phone contacts", subtitle = "${selected.size} selected", onBack = { nav.popBackStack() }) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            if (!granted) {
                EmptyState(Icons.Filled.Contacts, "Contacts permission needed", "Allow access to pick contacts to import.") {
                    Button(onClick = { perm.launch(Manifest.permission.READ_CONTACTS) }) { Text("Allow") }
                }
                return@Column
            }
            SearchField(q, { q = it }, "Search contacts", Modifier.padding(12.dp))
            Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${shown.size} contacts", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { shown.forEach { if (it.key !in selected) selected.add(it.key) } }) { Text("Select all") }
                TextButton(onClick = { selected.clear() }) { Text("Clear") }
            }
            var open by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(open, { open = it }, Modifier.padding(horizontal = 12.dp)) {
                OutlinedTextField(
                    value = if (target == 0L) "Don't add to a list" else campaigns.firstOrNull { it.id == target }?.name ?: "",
                    onValueChange = {}, readOnly = true, label = { Text("Add to calling list") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable)
                )
                ExposedDropdownMenu(open, { open = false }) {
                    DropdownMenuItem(text = { Text("Don't add to a list") }, onClick = { target = 0; open = false })
                    campaigns.forEach { c -> DropdownMenuItem(text = { Text(c.name) }, onClick = { target = c.id; open = false }) }
                }
            }
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        val sel = contacts.orEmpty().filter { it.key in selected }
                        val res = Repo.importCustomers(sel.map { ImportRow(it.name, it.phone) }, target.takeIf { it > 0 }, false)
                        Toast.makeText(ctx, "Added ${res.added}, already existed ${res.updated + res.skipped}", Toast.LENGTH_LONG).show()
                        busy = false
                        nav.popBackStack()
                    }
                },
                enabled = selected.isNotEmpty() && !busy,
                modifier = Modifier.fillMaxWidth().padding(12.dp)
            ) { Text("Import ${selected.size} contacts") }
            if (contacts == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn {
                items(shown, key = { it.key }) { c ->
                    val sel = c.key in selected
                    ListItem(
                        modifier = Modifier.clickable { if (sel) selected.remove(c.key) else selected.add(c.key) },
                        leadingContent = { Checkbox(sel, null) },
                        headlineContent = { Text(c.name, fontWeight = FontWeight.Medium) },
                        supportingContent = { Text(c.phone) }
                    )
                }
            }
        }
    }
}
