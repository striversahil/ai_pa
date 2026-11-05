package in.brindavan.foundercalls

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import in.brindavan.foundercalls.call.CallTrackingService
import in.brindavan.foundercalls.data.Permissions
import in.brindavan.foundercalls.ui.CallDetailScreen
import in.brindavan.foundercalls.ui.CallLogScreen
import in.brindavan.foundercalls.ui.ConsentScreen
import in.brindavan.foundercalls.ui.FounderCallsTheme
import in.brindavan.foundercalls.ui.HomeScreen
import in.brindavan.foundercalls.ui.MatrixScreen
import in.brindavan.foundercalls.ui.PermissionsScreen
import kotlinx.coroutines.launch

sealed interface Screen {
    data object Home : Screen
    data object Permissions : Screen
    data object Log : Screen
    data class Detail(val id: String) : Screen
    data object Matrix : Screen
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { FounderCallsTheme { Root() } }
    }
}

@Composable
private fun Root() {
    val activity = androidx.compose.ui.platform.LocalContext.current as ComponentActivity
    val app = activity.applicationContext as FounderCallsApp
    val prefs = app.container.prefs
    val scope = rememberCoroutineScope()

    val consent by prefs.consentAccepted.collectAsState(initial = false)
    val tracking by prefs.trackingEnabled.collectAsState(initial = false)
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var permissionTick by remember { mutableStateOf(0) }

    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permissionTick++
    }

    val missing = remember(consent, permissionTick) { Permissions.missing(activity) }

    LaunchedEffect(tracking, consent) {
        if (tracking && consent && Permissions.hasCore(activity)) CallTrackingService.ensureRunning(activity)
    }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) {
            val nm = activity.getSystemService(android.app.NotificationManager::class.java)
            nm?.createNotificationChannel(
                android.app.NotificationChannel("call_tracking", "Call tracking", android.app.NotificationManager.IMPORTANCE_LOW),
            )
        }
        if (Build.VERSION.SDK_INT >= 33) {
            val permission = Manifest.permission.POST_NOTIFICATIONS
            if (androidx.core.content.ContextCompat.checkSelfPermission(activity, permission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                launcher.launch(arrayOf(permission))
            }
        }
    }

    BackHandler(enabled = screen != Screen.Home) { screen = Screen.Home }

    when {
        !consent -> ConsentScreen(onAccept = { scope.launch { prefs.setConsent(true) } })
        missing.isNotEmpty() || !Permissions.hasCore(activity) -> PermissionsScreen(onDone = { permissionTick++ })
        else -> when (val s = screen) {
            Screen.Home -> HomeScreen(
                onOpenLog = { screen = Screen.Log },
                onOpenMatrix = { screen = Screen.Matrix },
                onOpenPermissions = { screen = Screen.Permissions },
            )
            Screen.Permissions -> PermissionsScreen(onDone = { screen = Screen.Home })
            Screen.Log -> CallLogScreen(onOpen = { screen = Screen.Detail(it) })
            is Screen.Detail -> CallDetailScreen(s.id, onBack = { screen = Screen.Log })
            Screen.Matrix -> MatrixScreen(onBack = { screen = Screen.Home })
        }
    }
}
