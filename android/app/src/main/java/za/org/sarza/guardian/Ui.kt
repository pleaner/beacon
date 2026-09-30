package za.org.sarza.guardian

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

// The web app's colours.
val Navy = Color(0xFF212C65)
val Red = Color(0xFFD2202F)
val Yellow = Color(0xFFFADF06)
val Green = Color(0xFF1E8A4C)
val Muted = Color(0xFF565D78)
val Ground = Color(0xFFF3F4F7)

@Composable
fun GuardianTheme(content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = lightColorScheme(primary = Navy, secondary = Navy, error = Red, background = Ground), content = content)

// A screen: coloured background, scrolling column, clear of the status bar and keyboard.
@Composable
fun Page(background: Color = Ground, content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxSize(), color = background) {
        Column(
            Modifier.safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
fun Title(text: String, color: Color = Navy) =
    Text(text.uppercase(), color = color, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 36.sp)

@Composable
fun Heading(text: String, color: Color = Navy) = Text(text.uppercase(), color = color, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, type: KeyboardType = KeyboardType.Text, lines: Int = 1) =
    OutlinedTextField(value, onChange, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = lines == 1, minLines = lines,
        keyboardOptions = KeyboardOptions(keyboardType = type))

@Composable
fun BigButton(text: String, color: Color = Navy, enabled: Boolean = true, onClick: () -> Unit) =
    Button(onClick, Modifier.fillMaxWidth().height(56.dp), enabled = enabled, colors = ButtonDefaults.buttonColors(containerColor = color)) {
        Text(text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
    }

@Composable
fun ErrorText(text: String?) {
    if (text != null) Text(text, color = Red, fontWeight = FontWeight.SemiBold)
}

// Drag the knob all the way across. A tap does nothing, so it can't go off in a pocket.
@Composable
fun SlideToConfirm(text: String, color: Color, onDone: () -> Unit) {
    var width by remember { mutableIntStateOf(0) }
    var x by remember { mutableFloatStateOf(0f) }
    val knob = with(LocalDensity.current) { 56.dp.toPx() }
    val max = (width - knob).coerceAtLeast(1f)
    Box(Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(32.dp)).background(color).onSizeChanged { width = it.width }) {
        Text(text, Modifier.align(Alignment.Center), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Box(
            Modifier.offset { IntOffset(x.roundToInt(), 0) }.padding(4.dp).size(56.dp).clip(CircleShape).background(Color.White)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { d -> x = (x + d).coerceIn(0f, max) },
                    onDragStopped = { if (x > max * 0.9f) onDone(); x = 0f },
                ),
            contentAlignment = Alignment.Center,
        ) { Text("›", color = color, fontSize = 30.sp, fontWeight = FontWeight.Bold) }
    }
}

// Runs network work off the main thread and keeps the busy flag and error message for the screen.
class Work {
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    fun run(scope: CoroutineScope, work: () -> Unit, then: () -> Unit = {}) = scope.launch {
        busy = true
        error = null
        try {
            withContext(Dispatchers.IO) { work() }
            then()
        } catch (e: Api.Failed) {
            error = e.message
        } catch (e: Exception) {
            error = "No connection. Check your signal and try again."
        } finally {
            busy = false
        }
    }
}

@Composable
fun rememberWork() = remember { Work() }

fun Context.open(uri: String) = runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri))) }
fun Context.call(phone: String) = open("tel:$phone")
fun Context.showOnMap(lat: Double, lng: Double, label: String) = open("geo:0,0?q=$lat,$lng(${Uri.encode(label)})")

fun ago(ms: Long): String {
    val m = (System.currentTimeMillis() - ms) / 60_000
    return when {
        m < 1 -> "just now"
        m < 60 -> "$m min ago"
        m < 1440 -> "${m / 60} h ${m % 60} min ago"
        else -> "${m / 1440} d ago"
    }
}
