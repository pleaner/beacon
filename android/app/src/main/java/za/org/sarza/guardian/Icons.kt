package za.org.sarza.guardian

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.group
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// The web app's stroke icons (src/views/icons.tsx), generated from the same paths so both apps look the same.
// Circles and rects are written out as paths.
private class P(val d: String, val rotate: Float = 0f, val px: Float = 0f, val py: Float = 0f)

private val PATHS: Map<String, List<P>> = mapOf(
    "hike" to listOf(P("M3 20 L9.5 9 L13 15 L15.5 11 L21 20 Z"), P("M8 13.5 L10 12 L11.5 13.5")),
    "run" to listOf(P("M13.2 4.5 A1.8 1.8 0 1 0 16.8 4.5 A1.8 1.8 0 1 0 13.2 4.5 Z"), P("M6 21 L9.5 15 L13 17 L14 12 L10 10 L7 12"), P("M14 12 L17 14.5 L20 13"), P("M9.5 15 L12 11.5")),
    "climb" to listOf(P("M11 3 H11 A5 5 0 0 1 16 8 V16 A5 5 0 0 1 11 21 H11 A5 5 0 0 1 6 16 V8 A5 5 0 0 1 11 3 Z", 20f, 11f, 12f), P("M14.5 7.5 L12.8 12")),
    "paraglide" to listOf(P("M3 9 C7 3.5 17 3.5 21 9"), P("M3.5 9 L12 18"), P("M20.5 9 L12 18"), P("M9 6.5 L12 18"), P("M15 6.5 L12 18"), P("M10.5 20 A1.5 1.5 0 1 0 13.5 20 A1.5 1.5 0 1 0 10.5 20 Z")),
    "mtb" to listOf(P("M2 16.5 A3.5 3.5 0 1 0 9 16.5 A3.5 3.5 0 1 0 2 16.5 Z"), P("M15 16.5 A3.5 3.5 0 1 0 22 16.5 A3.5 3.5 0 1 0 15 16.5 Z"), P("M5.5 16.5 L9.5 9 L15 9 L18.5 16.5"), P("M9.5 9 L12 16.5 L15 9"), P("M8 7 L11 7"), P("M14 6 L16 6")),
    "other" to listOf(P("M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z"), P("M12 7 L13.4 10.6 L17 12 L13.4 13.4 L12 17 L10.6 13.4 L7 12 L10.6 10.6 Z")),
    "phone" to listOf(P("M5 3 H9 L11 8 L8.5 9.5 C9.6 11.8 12.2 14.4 14.5 15.5 L16 13 L21 15 V19 C21 20.1 20.1 21 19 21 C10.2 21 3 13.8 3 5 C3 3.9 3.9 3 5 3 Z")),
    "mobile" to listOf(P("M9.5 2.5 H14.5 A2.5 2.5 0 0 1 17 5 V19 A2.5 2.5 0 0 1 14.5 21.5 H9.5 A2.5 2.5 0 0 1 7 19 V5 A2.5 2.5 0 0 1 9.5 2.5 Z"), P("M11 18 H13")),
    "camera" to listOf(P("M4 7 H7.5 L9 5 H15 L16.5 7 H20 C20.6 7 21 7.4 21 8 V18 C21 18.6 20.6 19 20 19 H4 C3.4 19 3 18.6 3 18 V8 C3 7.4 3.4 7 4 7 Z"), P("M8.5 13 A3.5 3.5 0 1 0 15.5 13 A3.5 3.5 0 1 0 8.5 13 Z")),
    "check" to listOf(P("M5 12.5 L10 17 L19 7")),
    "back" to listOf(P("M15 5 L8 12 L15 19")),
    "chev" to listOf(P("M9 5 L16 12 L9 19")),
    "chevs" to listOf(P("M6 6 L12 12 L6 18"), P("M12 6 L18 12 L12 18")),
    "down" to listOf(P("M6 9 L12 15 L18 9")),
    "bell" to listOf(P("M6 16 V11 C6 7.7 8.7 5 12 5 C15.3 5 18 7.7 18 11 V16 L20 18 H4 Z"), P("M10 21 H14")),
    "pin" to listOf(P("M12 21 C12 21 5 14.5 5 9.5 C5 5.9 8.1 3 12 3 C15.9 3 19 5.9 19 9.5 C19 14.5 12 21 12 21 Z"), P("M9.5 9.5 A2.5 2.5 0 1 0 14.5 9.5 A2.5 2.5 0 1 0 9.5 9.5 Z")),
    "gps" to listOf(P("M5 12 A7 7 0 1 0 19 12 A7 7 0 1 0 5 12 Z"), P("M9.5 12 A2.5 2.5 0 1 0 14.5 12 A2.5 2.5 0 1 0 9.5 12 Z"), P("M12 2 V5"), P("M12 19 V22"), P("M2 12 H5"), P("M19 12 H22")),
    "battery" to listOf(P("M5 7 H17 A2 2 0 0 1 19 9 V15 A2 2 0 0 1 17 17 H5 A2 2 0 0 1 3 15 V9 A2 2 0 0 1 5 7 Z"), P("M21 10.5 V13.5"), P("M6 10 V14"), P("M9 10 V14"), P("M12 10 V14")),
    "clock" to listOf(P("M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z"), P("M12 7 V12 L15.5 14")),
    "arrow" to listOf(P("M5 12 H19"), P("M13 6 L19 12 L13 18")),
    "user" to listOf(P("M8 8 A4 4 0 1 0 16 8 A4 4 0 1 0 8 8 Z"), P("M4 21 C4 16.6 7.6 14 12 14 C16.4 14 20 16.6 20 21")),
    "userCircle" to listOf(P("M2.5 12 A9.5 9.5 0 1 0 21.5 12 A9.5 9.5 0 1 0 2.5 12 Z"), P("M9 10 A3 3 0 1 0 15 10 A3 3 0 1 0 9 10 Z"), P("M6.5 18.5 C7.8 16.3 9.7 15 12 15 C14.3 15 16.2 16.3 17.5 18.5")),
    "users" to listOf(P("M5.5 8 A3.5 3.5 0 1 0 12.5 8 A3.5 3.5 0 1 0 5.5 8 Z"), P("M2.5 20 C2.5 16.5 5.5 14 9 14 C12.5 14 15.5 16.5 15.5 20"), P("M14.5 9 A2.5 2.5 0 1 0 19.5 9 A2.5 2.5 0 1 0 14.5 9 Z"), P("M17 14 C19.5 14 21.5 16 21.5 19")),
    "mail" to listOf(P("M5 5 H19 A2 2 0 0 1 21 7 V17 A2 2 0 0 1 19 19 H5 A2 2 0 0 1 3 17 V7 A2 2 0 0 1 5 5 Z"), P("M3.5 6 L12 13 L20.5 6")),
    "share" to listOf(P("M15.5 5 A2.5 2.5 0 1 0 20.5 5 A2.5 2.5 0 1 0 15.5 5 Z"), P("M3.5 12 A2.5 2.5 0 1 0 8.5 12 A2.5 2.5 0 1 0 3.5 12 Z"), P("M15.5 19 A2.5 2.5 0 1 0 20.5 19 A2.5 2.5 0 1 0 15.5 19 Z"), P("M8.2 10.8 L15.8 6.2"), P("M8.2 13.2 L15.8 17.8")),
    "ext" to listOf(P("M14 4 H20 V10"), P("M20 4 L11 13"), P("M18 14 V19 C18 19.6 17.6 20 17 20 H5 C4.4 20 4 19.6 4 19 V7 C4 6.4 4.4 6 5 6 H10")),
    "shoe" to listOf(P("M3 16 V9 L8 8 C9 10 11 11 13 11 L19 12.5 C20.2 12.8 21 13.8 21 15 V16 Z"), P("M3 19 H21")),
    "body" to listOf(P("M9.8 4.5 A2.2 2.2 0 1 0 14.2 4.5 A2.2 2.2 0 1 0 9.8 4.5 Z"), P("M8.5 9 C8.5 8 10 7.5 12 7.5 C14 7.5 15.5 8 15.5 9 V14 H14 L13.5 21"), P("M8.5 9 V14 H10 L10.5 21")),
    "flag" to listOf(P("M5 21 V4"), P("M5 4 H17 L14.5 8 L17 12 H5")),
    "route" to listOf(P("M4 19 A2 2 0 1 0 8 19 A2 2 0 1 0 4 19 Z"), P("M16 5 A2 2 0 1 0 20 5 A2 2 0 1 0 16 5 Z"), P("M8 19 H15 C17 19 18 17.5 18 16 C18 14.5 17 13 15 13 H9 C7 13 6 11.5 6 10 C6 8.5 7 7 9 7 H16")),
    "globe" to listOf(P("M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z"), P("M3 12 H21"), P("M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3 Z")),
    "cake" to listOf(P("M6 11 H18 A2 2 0 0 1 20 13 V19 A2 2 0 0 1 18 21 H6 A2 2 0 0 1 4 19 V13 A2 2 0 0 1 6 11 Z"), P("M4 15.5 C6 17 8 14 10 15.5 C12 17 14 14 16 15.5 C18 17 20 15.5 20 15.5"), P("M12 11 V7.5"), P("M12 3 C13 4.2 13 5.5 12 5.5 C11 5.5 11 4.2 12 3 Z")),
    "plan" to listOf(P("M7 4 H17 A2 2 0 0 1 19 6 V19 A2 2 0 0 1 17 21 H7 A2 2 0 0 1 5 19 V6 A2 2 0 0 1 7 4 Z"), P("M9 4 V3 H15 V4"), P("M9 10 H15"), P("M9 14 H13")),
    "x" to listOf(P("M6 6 L18 18"), P("M18 6 L6 18")),
    "mic" to listOf(P("M12 3 H12 A3 3 0 0 1 15 6 V11 A3 3 0 0 1 12 14 H12 A3 3 0 0 1 9 11 V6 A3 3 0 0 1 12 3 Z"), P("M5.5 11 C5.5 14.6 8.4 17.5 12 17.5 C15.6 17.5 18.5 14.6 18.5 11"), P("M12 17.5 V21")),
    "plus" to listOf(P("M12 5 V19"), P("M5 12 H19")),
    "paw" to listOf(P("M4.7 9 A1.8 1.8 0 1 0 8.3 9 A1.8 1.8 0 1 0 4.7 9 Z"), P("M8.2 5 A1.8 1.8 0 1 0 11.8 5 A1.8 1.8 0 1 0 8.2 5 Z"), P("M12.2 5 A1.8 1.8 0 1 0 15.8 5 A1.8 1.8 0 1 0 12.2 5 Z"), P("M15.7 9 A1.8 1.8 0 1 0 19.3 9 A1.8 1.8 0 1 0 15.7 9 Z"), P("M12 11 C9 11 6.5 14.5 6.5 17 C6.5 19 8 20 9.5 20 C10.5 20 11 19.5 12 19.5 C13 19.5 13.5 20 14.5 20 C16 20 17.5 19 17.5 17 C17.5 14.5 15 11 12 11 Z")),
    "menu" to listOf(P("M4 6 H20"), P("M4 12 H20"), P("M4 18 H20")),
    "board" to listOf(P("M5 4 H19 A2 2 0 0 1 21 6 V18 A2 2 0 0 1 19 20 H5 A2 2 0 0 1 3 18 V6 A2 2 0 0 1 5 4 Z"), P("M3 9 H21"), P("M9 9 V20")),
    "chat" to listOf(P("M5 4 H19 A2 2 0 0 1 21 6 V15 A2 2 0 0 1 19 17 H10 L6 20.5 V17 H5 A2 2 0 0 1 3 15 V6 A2 2 0 0 1 5 4 Z"), P("M8 9 H16"), P("M8 12.5 H13")),
    "list" to listOf(P("M9 6 H20"), P("M9 12 H20"), P("M9 18 H20"), P("M4 6 L5 7 L7 5"), P("M4 12 L5 13 L7 11"), P("M4 18 L5 19 L7 17")),
    "megaphone" to listOf(P("M3 11 V13 C3 13.6 3.4 14 4 14 H7 L14 18 V6 L7 10 H4 C3.4 10 3 10.4 3 11 Z"), P("M17.5 9 C18.5 10.5 18.5 13.5 17.5 15"), P("M7 14 L8 20")),
    "settings" to listOf(P("M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12 Z"), P("M12 2.5 V5"), P("M12 19 V21.5"), P("M2.5 12 H5"), P("M19 12 H21.5"), P("M5.3 5.3 L7 7"), P("M17 17 L18.7 18.7"), P("M5.3 18.7 L7 17"), P("M17 7 L18.7 5.3")),
    "logout" to listOf(P("M15 4 H19 C19.6 4 20 4.4 20 5 V19 C20 19.6 19.6 20 19 20 H15"), P("M10 16 L14 12 L10 8"), P("M14 12 H4")),
    "search" to listOf(P("M4 11 A7 7 0 1 0 18 11 A7 7 0 1 0 4 11 Z"), P("M16.5 16.5 L21 21")),
    "calendar" to listOf(P("M6 5 H18 A2.5 2.5 0 0 1 20.5 7.5 V18 A2.5 2.5 0 0 1 18 20.5 H6 A2.5 2.5 0 0 1 3.5 18 V7.5 A2.5 2.5 0 0 1 6 5 Z"), P("M3.5 10 H20.5"), P("M8 3 V7"), P("M16 3 V7")),
    "alert" to listOf(P("M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12 Z"), P("M6.3 6.3 A8 8 0 0 0 6.3 17.7"), P("M17.7 6.3 A8 8 0 0 1 17.7 17.7")),
)

private val cache = HashMap<Pair<String, Float>, ImageVector>()

fun iconVector(name: String, stroke: Float = 2f): ImageVector = cache.getOrPut(name to stroke) {
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (p in PATHS.getValue(name)) {
            group(rotate = p.rotate, pivotX = p.px, pivotY = p.py) {
                addPath(
                    pathData = addPathNodes(p.d), stroke = SolidColor(Color.Black), strokeLineWidth = stroke,
                    strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
                )
            }
        }
    }.build()
}

@Composable
fun GIcon(name: String, color: Color, size: Dp = 22.dp, stroke: Float = 2f, modifier: Modifier = Modifier) {
    val v = remember(name, stroke) { iconVector(name, stroke) }
    Icon(v, null, modifier.size(size), tint = color)
}
