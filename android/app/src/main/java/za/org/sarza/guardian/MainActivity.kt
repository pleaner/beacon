package za.org.sarza.guardian

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

sealed interface Screen {
    data object Welcome : Screen
    data object Profile : Screen
    data object Home : Screen
    data class HomeNotice(val text: String) : Screen
    data object Back : Screen
    data class Done(val id: String) : Screen
    data class NewTrip(val activity: String) : Screen
    data object Trip : Screen
    data object Board : Screen
    data class BoardTrip(val id: String) : Screen
    data object Messages : Screen
}

class MainActivity : ComponentActivity() {
    private var screen by mutableStateOf<Screen>(Screen.Welcome)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The navy app bar sits under the status bar on every screen, so its icons are always light.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        screen = home()
        handle(intent)
        setContent {
            GuardianTheme {
                val s = screen
                BackHandler(enabled = back(s) != null) { screen = back(s)!! }
                val go = { next: Screen -> screen = next }
                // Operators and admins switch between the explorer app, the board and messages on tabs along the bottom.
                val tabs = Store.role != "explorer" && (s == Screen.Home || s is Screen.HomeNotice || s == Screen.Board || s == Screen.Messages)
                Box(Modifier.fillMaxSize()) {
                    Column {
                        AppBar(if (s == Screen.Welcome) null else go)
                        // The tabs sit on the navigation bar, so the screen above them doesn't pad for it again.
                        Box(Modifier.weight(1f).then(if (tabs) Modifier.consumeWindowInsets(WindowInsets.navigationBars) else Modifier)) {
                            when (s) {
                                Screen.Welcome -> WelcomeScreen(go)
                                Screen.Profile -> ProfileScreen(go)
                                Screen.Home -> HomeScreen(go)
                                is Screen.HomeNotice -> HomeScreen(go, s.text)
                                Screen.Back -> BackScreen(go)
                                is Screen.Done -> DoneScreen(s.id, go)
                                is Screen.NewTrip -> NewTripScreen(s.activity, go)
                                Screen.Trip -> TripScreen(go)
                                Screen.Board -> BoardScreen(go)
                                is Screen.BoardTrip -> BoardTripScreen(s.id, go)
                                Screen.Messages -> MessagesScreen(go)
                            }
                        }
                        if (tabs) OpsTabs(s, go)
                    }
                    AlphaRibbon()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        // Opening the app answers the alarm.
        Alarm.stop(this)
        if (Store.role == "explorer" && Store.trip != null) runCatching { TripService.start(this) }
    }

    private fun handle(intent: Intent?) {
        val url = intent?.getStringExtra("url") ?: return
        Regex("^/board/trips/([^/?]+)").find(url)?.let { if (Store.role != "explorer" && Store.token != null) screen = Screen.BoardTrip(it.groupValues[1]) }
    }

    private fun back(s: Screen): Screen? = when (s) {
        Screen.Profile -> Screen.Home
        is Screen.NewTrip -> Screen.Home
        is Screen.BoardTrip -> Screen.Board
        Screen.Messages -> Screen.Board
        else -> null
    }

    companion object {
        fun home(): Screen = when {
            Store.token == null -> Screen.Welcome
            // An open trip comes first, for an admin out on one as much as for an explorer.
            Store.trip != null -> Screen.Trip
            Store.role != "explorer" -> Screen.Board
            // Signed in with Google but no phone yet: finish the profile first, like the web does.
            Store.me?.optJSONObject("user")?.optString("phone").isNullOrEmpty() -> Screen.Profile
            else -> Screen.Home
        }
    }
}
