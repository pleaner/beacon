package za.org.sarza.guardian

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

// The web app's design tokens (public/app.css :root).
val Navy = Color(0xFF212C65)
val Red = Color(0xFFD2202F)
val RedInk = Color(0xFFA3131F)
val Yellow = Color(0xFFFADF06)
val YellowLine = Color(0xFFE9CB00)
val Green = Color(0xFF1E8A4C)
val Ink = Color(0xFF141A3A)
val Muted = Color(0xFF565D78)
val Line = Color(0xFFDADDE6)
val Ground = Color(0xFFF3F4F7)
val NavyT = Color(0xFFE6E8F1)
val RedT = Color(0xFFFBE6E8)
val YellowT = Color(0xFFFEF7C2)
val Dashed = Color(0xFFC3C7D4)
val Alerted = Color(0xFF9B2C35)

val Display = FontFamily(Font(R.font.barlow_condensed_700, FontWeight.Bold), Font(R.font.barlow_condensed_800, FontWeight.ExtraBold))
val Body = FontFamily(
    Font(R.font.ibm_plex_sans_400, FontWeight.Normal), Font(R.font.ibm_plex_sans_500, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_600, FontWeight.SemiBold), Font(R.font.ibm_plex_sans_700, FontWeight.Bold),
)
val Mono = FontFamily(Font(R.font.ibm_plex_mono_500, FontWeight.Medium))

@Composable
fun GuardianTheme(content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = lightColorScheme(primary = Navy, secondary = Navy, error = Red, background = Ground, surface = Color.White)) {
        ProvideTextStyle(TextStyle(fontFamily = Body, fontSize = 16.sp, lineHeight = 23.sp, color = Ink), content)
    }

// ---------- text ----------

@Composable
fun DisplayText(text: String, color: Color = Navy, size: TextUnit = 40.sp, modifier: Modifier = Modifier, align: TextAlign? = null) =
    Text(text.uppercase(), modifier, color = color, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = size, lineHeight = size, textAlign = align)

@Composable
fun Lead(text: String, color: Color = Muted, align: TextAlign? = null) = Text(text, color = color, fontSize = 16.sp, textAlign = align)

// h2.label
@Composable
fun Label(text: String, color: Color = Navy) =
    Text(text.uppercase(), color = color, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = .04.em)

@Composable
fun FieldLabel(text: String) = Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)

// .note: small muted line with an icon
@Composable
fun Note(icon: String, text: String, color: Color = Muted) = Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    GIcon(icon, color, 18.dp, modifier = Modifier.padding(top = 2.dp))
    Text(text, color = color, fontSize = 14.sp, lineHeight = 20.sp)
}

@Composable
fun ErrorBanner(text: String?) {
    if (text != null) Box(Modifier.fillMaxWidth().background(RedT, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(text, color = RedInk, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

// .banner.ok / .soft / .warn
@Composable
fun Banner(bg: Color, fg: Color = Navy, icon: String? = null, border: Color? = null, content: @Composable ColumnScope.() -> Unit) = Row(
    Modifier.fillMaxWidth().background(bg, RoundedCornerShape(14.dp))
        .then(if (border != null) Modifier.border(1.5.dp, border, RoundedCornerShape(14.dp)) else Modifier)
        .padding(horizontal = 16.dp, vertical = 14.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    if (icon != null) GIcon(icon, fg, 20.dp, modifier = Modifier.padding(top = 1.dp))
    ProvideTextStyle(TextStyle(fontFamily = Body, fontSize = 15.sp, lineHeight = 21.sp, color = fg)) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

// ---------- buttons ----------

enum class Btn { Navy, Red, Yellow, Outline, Ghost }

@Composable
fun GButton(
    text: String, kind: Btn = Btn.Navy, icon: String? = null, enabled: Boolean = true, small: Boolean = false, big: Boolean = false,
    modifier: Modifier = Modifier.fillMaxWidth(), onClick: () -> Unit,
) {
    val (bg, fg) = when (kind) {
        Btn.Navy -> Navy to Color.White
        Btn.Red -> Red to Color.White
        Btn.Yellow -> Yellow to Ink
        Btn.Outline -> Color.White to Navy
        Btn.Ghost -> Color.Transparent to Muted
    }
    val shape = RoundedCornerShape(if (small) 10.dp else 14.dp)
    Row(
        modifier.heightIn(min = if (big) 64.dp else if (small || kind == Btn.Ghost) 44.dp else 58.dp).clip(shape).background(bg, shape)
            .then(if (kind == Btn.Outline) Modifier.border(2.dp, Navy, shape) else Modifier)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 18.dp)
            .then(if (enabled) Modifier else Modifier.background(Color.White.copy(alpha = .4f))),
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) GIcon(icon, fg, if (big) 26.dp else if (small) 20.dp else 24.dp, stroke = 2.4f)
        if (text.isNotEmpty()) Text(
            text, color = fg, fontWeight = if (kind == Btn.Ghost) FontWeight.SemiBold else FontWeight.Bold,
            fontSize = if (big) 20.sp else if (small) 15.sp else if (kind == Btn.Ghost) 16.sp else 18.sp,
        )
    }
}

@Composable
fun LinkText(text: String, color: Color = Navy, onClick: () -> Unit) = Text(
    text, Modifier.clickable(onClick = onClick).padding(vertical = 12.dp), color = color,
    fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline,
)

// .chip
@Composable
fun GChip(text: String, on: Boolean, modifier: Modifier = Modifier, icon: String? = null, onClick: () -> Unit) = Row(
    modifier.height(48.dp).clip(RoundedCornerShape(12.dp)).background(if (on) NavyT else Color.White)
        .border(1.5.dp, if (on) Navy else Line, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = if (icon != null) 14.dp else 4.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
) {
    if (icon != null) GIcon(icon, Navy, 18.dp)
    Text(text, color = Navy, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, softWrap = false)
}

// .add-person: dashed full-width button
@Composable
fun DashedButton(text: String, icon: String = "plus", onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().heightIn(min = 56.dp).dashed(14.dp).clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick),
    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
) {
    GIcon(icon, Navy, 22.dp, stroke = 2.4f)
    Text(text, color = Navy, fontWeight = FontWeight.Bold)
}

// A dashed border, which Compose's border() can't draw.
fun Modifier.dashed(radius: Dp, color: Color = Dashed, bg: Color = Color.White) = background(bg, RoundedCornerShape(radius)).drawBehind {
    drawRoundRect(
        color, cornerRadius = CornerRadius(radius.toPx()),
        style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()))),
    )
}

// ---------- fields ----------

// The web's filled input: grey ground, 12 radius, navy border when focused, an optional icon on the left and unit on the right.
@Composable
fun GInput(
    value: String, onChange: (String) -> Unit, placeholder: String, icon: String? = null, type: KeyboardType = KeyboardType.Text,
    lines: Int = 1, unit: String? = null, white: Boolean = false, modifier: Modifier = Modifier.fillMaxWidth(),
) {
    val focus = remember { MutableInteractionSource() }
    val focused by focus.collectIsFocusedAsState()
    BasicTextField(
        value, onChange, modifier, singleLine = lines == 1, minLines = if (lines == 1) 1 else lines,
        textStyle = TextStyle(fontFamily = Body, fontSize = 17.sp, color = Ink),
        keyboardOptions = KeyboardOptions(keyboardType = type), interactionSource = focus, cursorBrush = SolidColor(Navy),
        decorationBox = { inner ->
            Row(
                Modifier.heightIn(min = if (lines > 1) 92.dp else 52.dp).background(if (white) Color.White else Ground, RoundedCornerShape(12.dp))
                    .border(1.5.dp, if (focused) Navy else if (white) Line else Color.Transparent, RoundedCornerShape(12.dp))
                    .padding(start = if (icon != null) 14.dp else 16.dp, end = 14.dp, top = 13.dp, bottom = 13.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = if (lines > 1) Alignment.Top else Alignment.CenterVertically,
            ) {
                if (icon != null) GIcon(icon, Navy, 22.dp, modifier = Modifier.padding(top = if (lines > 1) 1.dp else 0.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, color = Color(0xFF8A8FA3), fontSize = 17.sp)
                    inner()
                }
                if (unit != null) Text(unit, color = Muted, fontWeight = FontWeight.SemiBold)
            }
        },
    )
}

// A select that looks like the inputs: the value (or placeholder), a chevron, and a menu of options.
@Composable
fun GSelect(
    value: String?, placeholder: String, options: List<Pair<String, String>>, onPick: (String) -> Unit,
    icon: String? = null, modifier: Modifier = Modifier.fillMaxWidth(), white: Boolean = false, leading: (@Composable () -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    val label = options.firstOrNull { it.first == value }?.second
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).background(if (white) Color.White else Ground)
                .clickable { open = true }.padding(start = 14.dp, end = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(if (leading != null) 8.dp else 12.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) GIcon(icon, Navy, 22.dp)
            leading?.invoke()
            Text(label ?: placeholder, Modifier.weight(1f), color = if (label == null && leading == null) Color(0xFF8A8FA3) else Ink, fontSize = 17.sp,
                fontWeight = if (leading != null) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1, softWrap = false)
            GIcon("down", Navy, 18.dp)
        }
        DropdownMenu(open, { open = false }) {
            for ((v, l) in options) DropdownMenuItem({ Text(l) }, { onPick(v); open = false })
        }
    }
}

val COUNTRY_CODES = listOf(
    "27" to "South Africa", "264" to "Namibia", "267" to "Botswana", "263" to "Zimbabwe", "258" to "Mozambique", "266" to "Lesotho",
    "268" to "Eswatini", "44" to "United Kingdom", "49" to "Germany", "31" to "Netherlands", "33" to "France", "1" to "USA / Canada", "61" to "Australia",
)

// .phone: country code box with the flag, then the number.
@Composable
fun PhoneInput(code: String, onCode: (String) -> Unit, number: String, onNumber: (String) -> Unit, white: Boolean = false) =
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        GSelect(code, "+$code", COUNTRY_CODES.map { (c, n) -> c to if (c == code) "+$c" else "+$c  $n" }, onCode, modifier = Modifier.width(120.dp), white = white,
            leading = if (code == "27") ({ FlagZA() }) else null)
        GInput(number, onNumber, "82 123 4567", type = KeyboardType.Phone, white = white, modifier = Modifier.weight(1f))
    }

@Composable
fun FlagZA() = Canvas(Modifier.size(22.dp, 15.dp).clip(RoundedCornerShape(2.dp))) {
    val w = size.width; val h = size.height
    drawRect(Color(0xFF002395))
    drawRect(Color(0xFFDE3831), size = size.copy(height = h / 2))
    fun y(p: Path.() -> Unit) = Path().apply(p)
    val arm = y { moveTo(0f, 0f); lineTo(w / 2, h / 2); lineTo(0f, h); moveTo(w / 2, h / 2); lineTo(w, h / 2) }
    drawPath(arm, Color.White, style = Stroke(h / 3))
    drawPath(y { moveTo(0f, 0f); lineTo(w / 2, h / 2); lineTo(0f, h); close() }, Color(0xFFFFB612))
    drawPath(y { moveTo(0f, h * .12f); lineTo(w * .38f, h / 2); lineTo(0f, h * .88f); close() }, Color.Black)
    drawPath(arm, Color(0xFF007A4D), style = Stroke(h / 5))
}

// .check: 26dp box, navy when ticked.
@Composable
fun CheckRow(text: String, checked: Boolean, low: Boolean = false, onChange: (Boolean) -> Unit) = Row(
    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable { onChange(!checked) },
    horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
) {
    Box(
        Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)).background(if (checked) Navy else Color.White)
            .border(2.dp, if (checked) Navy else Color(0xFFB7BCCB), RoundedCornerShape(7.dp)),
        contentAlignment = Alignment.Center,
    ) { if (checked) GIcon("check", Color.White, 18.dp, stroke = 3.2f) }
    Text(text, color = if (low) Red else Ink, fontWeight = if (low) FontWeight.SemiBold else FontWeight.Normal)
}

// .seg: two-way segmented choice
@Composable
fun Seg(options: List<Triple<String, String, String>>, value: String, onPick: (String) -> Unit) = Row(
    Modifier.fillMaxWidth().background(NavyT, RoundedCornerShape(14.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp),
) {
    for ((v, label, icon) in options) {
        val on = v == value
        Row(
            Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(10.dp)).background(if (on) Navy else Color.Transparent).clickable { onPick(v) },
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
        ) {
            GIcon(icon, if (on) Color.White else Navy, 20.dp)
            Text(label, color = if (on) Color.White else Navy, fontWeight = FontWeight.Bold)
        }
    }
}

// .pill
@Composable
fun Pill(status: String) {
    val (bg, fg) = when (status) {
        "help" -> Red to Color.White
        "overdue" -> Yellow to Ink
        "closed" -> Color(0xFFE4E5EA) to Muted
        else -> Green to Color.White
    }
    Box(Modifier.height(24.dp).background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
        Text(status.uppercase(), color = fg, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = .08.em)
    }
}

// Numbered circle: yellow on navy (.how .n) or ink on yellow (.setup .n).
@Composable
fun Num(n: Int, bg: Color, fg: Color) = Box(Modifier.size(36.dp).background(bg, CircleShape), contentAlignment = Alignment.Center) {
    Text("$n", color = fg, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
}

@Composable
fun Logo(size: Dp) = Image(painterResource(R.drawable.sarza_logo), "SARZA", Modifier.size(size))

// ---------- page frames ----------

// Dark status bar icons on light pages, light ones on navy or red.
@Composable
fun SystemBars(darkBackground: Boolean) {
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkBackground
    }
}

// A plain full-height page: coloured background, scrolling, clear of the system bars and keyboard.
@Composable
fun Page(background: Color = Ground, gap: Dp = 20.dp, top: Dp = 24.dp, content: @Composable ColumnScope.() -> Unit) {
    SystemBars(background == Navy || background == Red)
    Surface(Modifier.fillMaxSize(), color = background) {
        Column(
            Modifier.statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = top, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(gap),
            content = content,
        )
    }
}

// The explorer app bar: navy, the badge, GUARDIAN / SARZA SEARCH & RESCUE, a yellow strip below.
@Composable
fun AppBar(menu: List<Pair<String, () -> Unit>> = emptyList()) = Column(Modifier.background(Navy).statusBarsPadding()) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(start = 52.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Logo(38.dp)
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            Text("GUARDIAN", color = Color.White, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, lineHeight = 24.sp, letterSpacing = .02.em)
            Text("SARZA SEARCH & RESCUE", color = Yellow, fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .14.em)
        }
        if (menu.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            Box {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable { open = true }, contentAlignment = Alignment.Center) {
                    GIcon("menu", Color.White, 24.dp)
                }
                DropdownMenu(open, { open = false }) {
                    for ((l, f) in menu) DropdownMenuItem({ Text(l) }, { open = false; f() })
                }
            }
        }
    }
    Box(Modifier.fillMaxWidth().height(4.dp).background(Yellow))
}

// A screen under the app bar.
@Composable
fun AppPage(menu: List<Pair<String, () -> Unit>> = emptyList(), background: Color = Ground, content: @Composable ColumnScope.() -> Unit) {
    SystemBars(true)
    Surface(Modifier.fillMaxSize(), color = background) {
        Column {
            AppBar(menu)
            Column(
                Modifier.weight(1f).navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp), content = content,
            )
        }
    }
}

// The multi-step flows (.flow-head, .step): back, "2/5", an optional control on the right, progress bars; then the badge and
// title, the step's fields, and the actions pinned to the bottom.
@Composable
fun FlowPage(
    step: Int, total: Int, title: String, lead: String?, onBack: () -> Unit,
    trailing: (@Composable () -> Unit)? = null, actions: @Composable ColumnScope.() -> Unit, content: @Composable ColumnScope.() -> Unit,
) = Surface(Modifier.fillMaxSize(), color = Color.White) {
    SystemBars(false)
    Column(Modifier.statusBarsPadding().navigationBarsPadding().imePadding()) {
        Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp)) {
            Box(Modifier.fillMaxWidth().height(48.dp)) {
                Box(Modifier.size(44.dp).align(Alignment.CenterStart).clip(RoundedCornerShape(10.dp)).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                    GIcon("back", Navy, 24.dp)
                }
                Text("${step + 1}/$total", Modifier.align(Alignment.Center), color = Muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                if (trailing != null) Box(Modifier.align(Alignment.CenterEnd)) { trailing() }
            }
            Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (i in 0 until total) Box(Modifier.weight(1f).height(4.dp).background(if (i <= step) Navy else Line, RoundedCornerShape(2.dp)))
            }
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(64.dp)
                    DisplayText(title)
                }
                if (lead != null) Lead(lead)
            }
            content()
        }
        Column(Modifier.background(Color.White).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = actions)
    }
}

// .help-slider: drag the red knob all the way across. A tap does nothing, so it can't go off in a pocket.
@Composable
fun HelpSlider(text: String = "Slide to call for help", onDone: () -> Unit) = SlideTrack(
    Modifier.fillMaxWidth().height(72.dp), RedT, Red, 62.dp, 36.dp, onDone,
) {
    Text(text.uppercase(), Modifier.padding(start = 60.dp), color = RedInk, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 19.sp, letterSpacing = .04.em)
}

// .slide-cancel in the trip flow's header: a small track, drag the knob right to cancel.
@Composable
fun SlideCancel(onDone: () -> Unit) = SlideTrack(Modifier.width(104.dp).height(44.dp), Ground, Line, 35.dp, 22.dp, onDone, knobColor = Color.White, knobIcon = "x", knobInk = Navy) {
    GIcon("chevs", Color(0xFF9AA0B6), 18.dp, modifier = Modifier.padding(start = 50.dp))
}

@Composable
private fun SlideTrack(
    modifier: Modifier, bg: Color, border: Color, knob: Dp, radius: Dp, onDone: () -> Unit,
    knobColor: Color = Red, knobIcon: String = "arrow", knobInk: Color = Color.White, label: @Composable () -> Unit,
) {
    var width by remember { mutableIntStateOf(0) }
    var x by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val knobPx = with(density) { knob.toPx() }
    val pad = with(density) { ((radius * 2 - knob) / 2).toPx() }
    val max = (width - knobPx - pad * 2).coerceAtLeast(1f)
    Box(
        modifier.clip(RoundedCornerShape(radius)).background(bg).border(if (border == Line) 1.5.dp else 2.dp, border, RoundedCornerShape(radius))
            .onSizeChanged { width = it.width },
        contentAlignment = Alignment.Center,
    ) {
        label()
        Box(
            Modifier.align(Alignment.CenterStart).offset { IntOffset((x + pad).roundToInt(), 0) }.size(knob).clip(CircleShape).background(knobColor)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { d -> x = (x + d).coerceIn(0f, max) },
                    onDragStopped = { if (x > max * 0.9f) onDone(); x = 0f },
                ),
            contentAlignment = Alignment.Center,
        ) { GIcon(knobIcon, knobInk, if (knob > 40.dp) 26.dp else 18.dp, stroke = 2.4f) }
    }
}

// ---------- work ----------

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

// "+27 82 555 0147" for South African numbers, as stored otherwise.
fun formatPhone(p: String): String = Regex("^\\+27(\\d{2})(\\d{3})(\\d{4})$").find(p)?.let { "+27 ${it.groupValues[1]} ${it.groupValues[2]} ${it.groupValues[3]}" } ?: p

val ACTIVITY_ICON = mapOf("hike" to "hike", "run" to "run", "climb" to "climb", "paraglide" to "paraglide", "mtb" to "mtb", "other" to "other")
// The build's corner ribbon. Only text, so touches pass through to the screen.
@Composable
// Below the status bar, tucked into the app's top-left corner; the top bars start a little further in to make room.
fun AlphaRibbon() = Box(Modifier.statusBarsPadding().size(64.dp).clipToBounds()) {
    Text(
        "ALPHA v${BuildConfig.VERSION_NAME}",
        // requiredWidth wider than the box centres the text on it, so x here is measured from the box's middle.
        Modifier.offset((-4).dp, 22.dp).requiredWidth(100.dp).rotate(-45f).background(Red).padding(vertical = 1.dp),
        color = Color.White, fontSize = 7.sp, fontWeight = FontWeight.Bold, letterSpacing = .08.em, textAlign = TextAlign.Center,
    )
}

val ACTIVITY_NOUN = mapOf("hike" to "hike", "run" to "run", "climb" to "climb", "paraglide" to "flight", "mtb" to "ride", "other" to "trip")
