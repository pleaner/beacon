package za.org.sarza.guardian

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

sealed interface Screen {
    data object Welcome : Screen
    data object Profile : Screen
    data object Home : Screen
    data class NewTrip(val activity: String) : Screen
    data object Trip : Screen
    data class SignIn(val link: String?) : Screen
    data object Board : Screen
    data class BoardTrip(val id: String) : Screen
}

class MainActivity : ComponentActivity() {
    private var screen by mutableStateOf<Screen>(Screen.Welcome)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        screen = home()
        handle(intent)
        setContent {
            GuardianTheme {
                val s = screen
                BackHandler(enabled = back(s) != null) { screen = back(s)!! }
                val go = { next: Screen -> screen = next }
                when (s) {
                    Screen.Welcome -> WelcomeScreen(go)
                    Screen.Profile -> ProfileScreen(go)
                    Screen.Home -> HomeScreen(go)
                    is Screen.NewTrip -> NewTripScreen(s.activity, go)
                    Screen.Trip -> TripScreen(go)
                    is Screen.SignIn -> SignInScreen(s.link, go)
                    Screen.Board -> BoardScreen(go)
                    is Screen.BoardTrip -> BoardTripScreen(s.id, go)
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
        val link = intent?.data
        if (link?.path == "/auth/verify") { screen = Screen.SignIn(link.toString()); return }
        val url = intent?.getStringExtra("url") ?: return
        Regex("^/board/trips/([^/?]+)").find(url)?.let { if (Store.role != "explorer" && Store.token != null) screen = Screen.BoardTrip(it.groupValues[1]) }
    }

    private fun back(s: Screen): Screen? = when (s) {
        Screen.Profile -> if (Store.token == null) Screen.Welcome else Screen.Home
        is Screen.NewTrip -> Screen.Home
        is Screen.SignIn -> if (Store.token == null) Screen.Welcome else null
        is Screen.BoardTrip -> Screen.Board
        else -> null
    }

    companion object {
        fun home(): Screen = when {
            Store.token == null -> Screen.Welcome
            Store.role != "explorer" -> Screen.Board
            Store.trip != null -> Screen.Trip
            else -> Screen.Home
        }
    }
}
