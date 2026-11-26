package com.miniautodialer.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Customer
import com.miniautodialer.app.notify.Notifications
import com.miniautodialer.app.remote.AutoDialer
import com.miniautodialer.app.ui.screens.*
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.DialerSync
import com.miniautodialer.app.util.RecordingImporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val intents = MutableStateFlow<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        CallManager.load(this)
        if (savedInstanceState == null) intents.value = intent
        setContent { MiniDialerTheme { AppRoot(intents) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intents.value = intent
    }
}

/** Starts a call for a customer; asks for call permissions the first time. */
typealias Caller = (Customer, Long?) -> Unit

val LocalCaller = staticCompositionLocalOf<Caller> { { _, _ -> } }

@Composable
fun rememberCaller(): Caller {
    val ctx = LocalContext.current
    var pendingArgs by remember { mutableStateOf<Pair<Customer, Long?>?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pendingArgs?.let { (c, cid) -> CallManager.dial(ctx, c.id, cid, c.phone)?.let { e -> Toast.makeText(ctx, e, Toast.LENGTH_LONG).show() } }
        pendingArgs = null
    }
    return remember {
        { c: Customer, cid: Long? ->
            if (CallManager.canCall(ctx) && CallManager.canReadLog(ctx)) {
                CallManager.dial(ctx, c.id, cid, c.phone)?.let { e -> Toast.makeText(ctx, e, Toast.LENGTH_LONG).show() }
            } else {
                pendingArgs = c to cid
                launcher.launch(arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_CALL_LOG))
            }
        }
    }
}

private data class TopItem(val route: String, val label: String, val icon: ImageVector)

/** Bottom bar: Home first, the Dialer as the big centre button. Lists/Customers are reachable from Home only. */
private const val DIALER = "dialer"
private val TOP = listOf(
    TopItem("dashboard", "Home", Icons.Filled.Dashboard),
    TopItem("followups", "Callbacks", Icons.Filled.Event),
    TopItem(DIALER, "Dialer", Icons.Filled.Call),
    TopItem("recordings", "Records", Icons.Filled.Mic),
    TopItem("settings", "Settings", Icons.Filled.Settings),
)

/** The raised round Dialer button in the middle of the bar. */
@Composable
private fun RowScope.DialerTab(selected: Boolean, onClick: () -> Unit) {
    // No fillMaxHeight: NavigationBar only sets a MIN height, so filling would stretch the bar over the whole screen.
    Column(Modifier.weight(1f).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = if (selected) CallGreen else Brand,
            shadowElevation = 6.dp,
            modifier = Modifier.size(54.dp),
        ) {
            Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.Call, "Dialer", tint = Color.White, modifier = Modifier.size(28.dp)) }
        }
        Text("Dialer", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (selected) CallGreen else Brand)
    }
}

private var lastAutoScan = 0L

@Composable
fun AppRoot(intents: MutableStateFlow<Intent?>) {
    val nav = rememberNavController()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val caller = rememberCaller()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    // first launch: reminders + automatic recording discovery (audio files, read-only)
    val startPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[RecordingImporter.audioPermission] == true) scope.launch { RecordingImporter.scan(ctx) }
    }
    LaunchedEffect(Unit) {
        val ask = buildList {
            if (Build.VERSION.SDK_INT >= 33 && !Notifications.canNotify(ctx)) add(Manifest.permission.POST_NOTIFICATIONS)
            if (!RecordingImporter.hasAudioAccess(ctx)) add(RecordingImporter.audioPermission)
        }
        if (ask.isNotEmpty()) startPermLauncher.launch(ask.toTypedArray())
    }

    val incoming by intents.collectAsState()
    LaunchedEffect(incoming) {
        val i = incoming ?: return@LaunchedEffect
        // clearing the intent restarts this effect, so the work runs in a scope that is not cancelled by that
        intents.value = null
        scope.launch {
            // recordings shared from another app (e.g. Google Phone keeps call recordings inside its own app)
            val shared = sharedUris(i)
            if (shared.isNotEmpty()) {
                val r = RecordingImporter.importUris(ctx, shared, null)
                val msg = when {
                    r.error != null -> r.error
                    r.imported == 0 -> "Could not read the shared recording"
                    r.matched == r.imported -> "Recording imported and linked to the customer"
                    else -> "Recording imported. Tap it and choose Assign to link it to a customer."
                }
                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
                if (r.imported > 0) runCatching { nav.goTop("recordings") }
                return@launch
            }
            val open = i.getLongExtra(Notifications.EXTRA_CUSTOMER, 0)
            val call = i.getLongExtra(Notifications.EXTRA_CALL_CUSTOMER, 0)
            if (open > 0) runCatching { nav.navigate("customer/$open") }
            if (call > 0) {
                MiniDialerApp.db.customers().get(call)?.let { c ->
                    runCatching { nav.navigate("customer/${c.id}") }
                    caller(c, null)
                }
            }
        }
    }

    // ON_RESUME can fire before the NavHost has its graph (cold start), so navigation happens in an effect
    var resumes by remember { mutableIntStateOf(0) }
    LaunchedEffect(resumes) {
        if (resumes == 0) return@LaunchedEffect
        fun openLogCall() {
            if (nav.currentDestination?.route != "logcall") runCatching { nav.navigate("logcall") }
        }
        val pc = CallManager.pending.value
        if (pc != null && MiniDialerApp.session.dialActive) {
            // an auto-dialer call: coming back is not "call ended" — AutoDialer asks the phone
            // (live call stays on Calling, hung up → disposition, SIM picker cancelled → not placed)
            if (!pc.dialed || System.currentTimeMillis() - pc.startedAt > 1500) {
                if (nav.currentDestination?.route != "dialer") runCatching { nav.goTop("dialer") }
                AutoDialer.onResume(ctx)
            }
        } else if (pc != null) {
            if (!pc.dialed || System.currentTimeMillis() - pc.startedAt > 1500) openLogCall()
        } else if (MiniDialerApp.prefs.trackDialer) {
            // calls made from the phone's own dialer
            if (DialerSync.sync(ctx) != null) openLogCall()
        }
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        resumes++
        val prefs = MiniDialerApp.prefs
        if (prefs.autoScan && RecordingImporter.canAutoFind(ctx) && System.currentTimeMillis() - lastAutoScan > 20_000) {
            lastAutoScan = System.currentTimeMillis()
            scope.launch { RecordingImporter.scan(ctx) }
        }
    }

    CompositionLocalProvider(LocalCaller provides caller) {
        Scaffold(
            contentWindowInsets = WindowInsets(0),
            bottomBar = {
                if (TOP.any { it.route == route }) {
                    NavigationBar {
                        TOP.forEach { item ->
                            if (item.route == DIALER) { DialerTab(route == DIALER) { nav.goTop(DIALER) }; return@forEach }
                            NavigationBarItem(
                                selected = route == item.route,
                                onClick = { nav.goTop(item.route) },
                                icon = { Icon(item.icon, item.label) },
                                label = { Text(item.label, maxLines = 1, softWrap = false, fontSize = 10.sp, overflow = TextOverflow.Clip) }
                            )
                        }
                    }
                }
            }
        ) { p ->
            NavHost(nav, startDestination = "dialer", modifier = Modifier.padding(p)) {
                composable("dialer") { DialerScreen(nav) }
                composable("dashboard") { DashboardScreen(nav) }
                composable("campaigns") { CampaignsScreen(nav) }
                composable("customers") { CustomersScreen(nav) }
                composable("followups") { FollowUpsScreen(nav) }
                composable("recordings") { RecordingsScreen(nav) }
                composable("campaign/{id}", arguments = listOf(navArgument("id") { type = NavType.LongType })) {
                    CampaignDetailScreen(nav, it.arguments!!.getLong("id"))
                }
                composable(
                    "session/{cid}?start={start}",
                    arguments = listOf(
                        navArgument("cid") { type = NavType.LongType },
                        navArgument("start") { type = NavType.LongType; defaultValue = 0L })
                ) { SessionScreen(nav, it.arguments!!.getLong("cid"), it.arguments!!.getLong("start")) }
                composable("customer/{id}", arguments = listOf(navArgument("id") { type = NavType.LongType })) {
                    CustomerDetailScreen(nav, it.arguments!!.getLong("id"))
                }
                composable(
                    "edit/{id}?campaign={campaign}",
                    arguments = listOf(
                        navArgument("id") { type = NavType.LongType },
                        navArgument("campaign") { type = NavType.LongType; defaultValue = 0L })
                ) { CustomerEditScreen(nav, it.arguments!!.getLong("id"), it.arguments!!.getLong("campaign")) }
                composable(
                    "import?campaign={campaign}",
                    arguments = listOf(navArgument("campaign") { type = NavType.LongType; defaultValue = 0L })
                ) { ImportScreen(nav, it.arguments!!.getLong("campaign")) }
                composable(
                    "contacts?campaign={campaign}",
                    arguments = listOf(navArgument("campaign") { type = NavType.LongType; defaultValue = 0L })
                ) { ContactsImportScreen(nav, it.arguments!!.getLong("campaign")) }
                composable("pick/{cid}", arguments = listOf(navArgument("cid") { type = NavType.LongType })) {
                    PickCustomersScreen(nav, it.arguments!!.getLong("cid"))
                }
                composable("logcall") { LogCallScreen(nav) }
                composable("dialpad") { DialPadScreen(nav) }
                composable("reports") { ReportsScreen(nav) }
                composable("settings") { SettingsScreen(nav) }
            }
        }
    }
}

/** Audio files sent to this app with Android's Share menu. */
@Suppress("DEPRECATION")
private fun sharedUris(i: Intent): List<android.net.Uri> {
    if (i.action != Intent.ACTION_SEND && i.action != Intent.ACTION_SEND_MULTIPLE) return emptyList()
    val out = mutableListOf<android.net.Uri>()
    (i.getParcelableExtra<android.os.Parcelable>(Intent.EXTRA_STREAM) as? android.net.Uri)?.let { out += it }
    i.getParcelableArrayListExtra<android.os.Parcelable>(Intent.EXTRA_STREAM)?.forEach { (it as? android.net.Uri)?.let(out::add) }
    i.clipData?.let { c -> for (n in 0 until c.itemCount) c.getItemAt(n).uri?.let(out::add) }
    return out.distinct()
}

fun NavHostController.goTop(route: String) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}
