package com.miniautodialer.app.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Customer
import com.miniautodialer.app.data.Repo
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.PhoneUtil
import kotlinx.coroutines.launch

/** Manual dialer: type any number and call it. The call is tracked like any other (outcome, history, recording). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DialPadScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val caller = LocalCaller.current
    val db = MiniDialerApp.db
    var number by rememberSaveable { mutableStateOf("") }
    var newName by rememberSaveable { mutableStateOf("") }
    var match by remember { mutableStateOf<Customer?>(null) }
    var suggestions by remember { mutableStateOf(emptyList<Customer>()) }

    LaunchedEffect(number) {
        val digits = number.filter { it.isDigit() }
        match = if (PhoneUtil.isValid(digits)) db.customers().byPhoneKey(PhoneUtil.key(digits)) else null
        suggestions = if (digits.length >= 3 && match == null) db.customers().byDigits(digits) else emptyList()
    }

    fun call() {
        val phone = PhoneUtil.clean(number)
        if (!PhoneUtil.isValid(phone)) { Toast.makeText(ctx, "Enter a phone number", Toast.LENGTH_SHORT).show(); return }
        scope.launch {
            val c = match ?: Repo.customerForNumber(phone, newName, "Added from dial pad")
            if (c == null) { Toast.makeText(ctx, "Could not save this number", Toast.LENGTH_SHORT).show(); return@launch }
            caller(c, Repo.pendingCampaignFor(c.id))
        }
    }

    AppScaffold(title = "Dial pad", subtitle = "Calls made here are tracked", onBack = { nav.popBackStack() }, actions = {
        IconButton(onClick = {
            val clip = (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString().orEmpty()
            val cleaned = PhoneUtil.clean(text)
            if (PhoneUtil.isValid(cleaned)) number = cleaned else Toast.makeText(ctx, "No phone number in clipboard", Toast.LENGTH_SHORT).show()
        }) { Icon(Icons.Filled.ContentPaste, "Paste number") }
    }) { p ->
        Column(
            Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                number.ifEmpty { "Enter number" }, fontSize = 32.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center,
                color = if (number.isEmpty()) Color.LightGray else Color.Unspecified, maxLines = 1, modifier = Modifier.fillMaxWidth()
            )
            Box(Modifier.heightIn(min = 72.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                val m = match
                when {
                    m != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable { nav.navigate("customer/${m.id}") }) {
                        Text(m.name, fontWeight = FontWeight.Bold, color = Brand, fontSize = 18.sp)
                        if (m.company.isNotBlank()) Text(m.company, color = Color.Gray)
                    }
                    suggestions.isNotEmpty() -> Column(Modifier.fillMaxWidth()) {
                        suggestions.forEach { c ->
                            Row(Modifier.fillMaxWidth().clickable { number = c.phone }.padding(vertical = 4.dp)) {
                                Text(c.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1)
                                Text(c.phone, color = Color.Gray)
                            }
                        }
                    }
                    PhoneUtil.isValid(number) -> OutlinedTextField(
                        newName, { newName = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        label = { Text("Name (optional), saved as new customer") }
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            val keys = listOf(
                listOf("1" to "", "2" to "ABC", "3" to "DEF"),
                listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
                listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ"),
                listOf("*" to "", "0" to "+", "#" to ""),
            )
            keys.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                    row.forEach { (k, sub) ->
                        Box(
                            Modifier.size(76.dp).clip(CircleShape).background(Color(0xFFF1F5F9)).combinedClickable(
                                onClick = { if (number.length < 20) number += k },
                                onLongClick = { if (k == "0" && number.isEmpty()) number = "+" else if (number.length < 20) number += k },
                            ),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(k, fontSize = 28.sp)
                                if (sub.isNotEmpty()) Text(sub, fontSize = 10.sp, color = Color.Gray)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.size(76.dp))
                Spacer(Modifier.width(20.dp))
                FloatingActionButton(onClick = { call() }, containerColor = CallGreen, contentColor = Color.White, shape = CircleShape, modifier = Modifier.size(76.dp)) {
                    Icon(Icons.Filled.Call, "Call", Modifier.size(34.dp))
                }
                Spacer(Modifier.width(20.dp))
                Box(
                    Modifier.size(76.dp).clip(CircleShape).combinedClickable(
                        onClick = { number = number.dropLast(1) }, onLongClick = { number = "" }
                    ),
                    contentAlignment = Alignment.Center
                ) { if (number.isNotEmpty()) Icon(Icons.AutoMirrored.Filled.Backspace, "Delete", tint = Color.Gray) }
            }
        }
    }
}
