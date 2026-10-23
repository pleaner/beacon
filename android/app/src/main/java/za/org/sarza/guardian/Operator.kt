package za.org.sarza.guardian

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// The operator board's neutral chrome (--z* in app.css).
private val Z9 = Color(0xFF09090B)
private val ZM = Color(0xFF71717A)
private val ZB = Color(0xFFE4E4E7)
private val ZA = Color(0xFFF4F4F5)

// Set from every board, trip and on-call reply, so the top bar shows the chip while you're on shift.
var onCall by mutableStateOf(false)

private val TABS = listOf("" to "All", "help" to "Help", "overdue" to "Overdue", "active" to "Active")

fun initials(name: String) = name.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1).uppercase() }

@Composable
private fun OpsPage(content: @Composable ColumnScope.() -> Unit) = Surface(Modifier.fillMaxSize(), color = ZA) {
    Column(
        Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp), content = content,
    )
}

@Composable
fun BoardScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    var trips by remember { mutableStateOf<JSONArray?>(null) }
    var offline by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("") }
    var q by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        Guardian.registerForPush(context)
        while (true) {
            val r = withContext(Dispatchers.IO) { runCatching { Api.get("/api/board") } }
            r.onSuccess { trips = it.getJSONArray("trips"); onCall = it.optBoolean("on_call") }
            offline = r.isFailure
            if ((r.exceptionOrNull() as? Api.Failed)?.status == 401) { Store.signOut(); go(Screen.Welcome); return@LaunchedEffect }
            delay(30_000)
        }
    }
    val all = trips?.let { a -> List(a.length()) { a.getJSONObject(it) } }.orEmpty()
    OpsPage {
        Row(verticalAlignment = Alignment.Bottom) {
            DisplayText("Open trips", modifier = Modifier.weight(1f))
            Text("Refreshes every 30 s", color = Muted, fontSize = 13.sp)
        }
        if (!notificationsOn(context)) Banner(YellowT, Ink, "bell", YellowLine) {
            Text("Notifications are off on this phone, so you won't hear about help calls.")
            GButton("Enable alerts", small = true) { context.openAppSettings() }
        }
        if (offline) Banner(RedT, RedInk) { Text("No connection. Showing what we had.", fontWeight = FontWeight.SemiBold) }
        Row(Modifier.fillMaxWidth().background(ZB.copy(alpha = .6f), RoundedCornerShape(12.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((key, label) in TABS) {
                val n = if (key.isEmpty()) all.size else all.count { it.optString("status") == key }
                Box(
                    Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(9.dp)).background(if (tab == key) Color.White else Color.Transparent).clickable { tab = key },
                    contentAlignment = Alignment.Center,
                ) { Text("$label $n", color = if (tab == key) Z9 else ZM, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
        GInput(q, { q = it }, "Search name or place", "search", white = true)
        val needle = q.trim().lowercase()
        val shown = all.filter { t ->
            (tab.isEmpty() || t.optString("status") == tab) && (needle.isEmpty() || listOf("user_name", "place", "destination_text", "route_text").any { t.optString(it).lowercase().contains(needle) })
        }
        if (trips == null) Text("Loading…", color = Muted)
        else if (shown.isEmpty()) Text(if (all.isEmpty()) "No open trips." else "Nothing matches.", color = Muted)
        for (status in listOf("help", "overdue", "active")) {
            val group = shown.filter { it.optString("status") == status }
            if (group.isEmpty()) continue
            Text("${status.uppercase()} · ${group.size}", color = ZM, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = .06.em)
            for (t in group) TripRow(t) { go(Screen.BoardTrip(t.getString("id"))) }
        }
    }
}

@Composable
private fun TripRow(t: JSONObject, onClick: () -> Unit) {
    val help = t.optString("status") == "help"
    val last = t.optJSONObject("last")
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(if (help) RedT else Color.White).border(1.dp, if (help) Red else ZB, shape).clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(t.optString("status"))
            Text(t.optString("user_name"), Modifier.weight(1f), color = Z9, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            GIcon("chev", Z9, 18.dp)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GIcon(ACTIVITY_ICON[t.optString("activity")] ?: "other", Z9, 18.dp)
            Text(t.optString("line"), color = Z9)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GIcon("flag", ZM, 16.dp)
            val back = t.optLong("return_by")
            val dest = t.optString("destination_text").takeIf { !t.isNull("destination_text") && it.isNotEmpty() }
            Text(listOfNotNull(dest, "back by").joinToString(" · "), color = ZM, fontSize = 14.sp)
            Text("${android.text.format.DateFormat.format("EEE", back)} ${hhmm(back)}", color = Z9, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GIcon("pin", ZM, 14.dp)
            Text(if (last == null) "No position yet" else "Last position ${ago(last.optLong("at"))}", color = ZM, fontSize = 13.sp)
            GIcon("user", ZM, 14.dp, modifier = Modifier.padding(start = 6.dp))
            val with = t.optInt("companion_count")
            Text(if (with == 0) "Alone" else "With $with", color = ZM, fontSize = 13.sp)
            if (last != null && !last.isNull("battery")) {
                GIcon("battery", ZM, 14.dp, modifier = Modifier.padding(start = 6.dp))
                Text("${last.optInt("battery")}%", color = ZM, fontSize = 13.sp)
            }
        }
    }
}

// One trip's chat on its own, reached from the toggle on the trip page.
@Composable
fun ChatScreen(id: String, name: String, go: (Screen) -> Unit) = Column(Modifier.fillMaxSize().imePadding()) {
    Column(Modifier.background(ZA).padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 16.dp)) { TripHeader(id, name, chat = true, go) }
    Chat(id, "Message", mine = "operator", modifier = Modifier.weight(1f).navigationBarsPadding(), card = false)
}

// The top of the trip page and its chat, identical on both: back, the traveller's name, then Trip and Chat side by side.
@Composable
private fun TripHeader(id: String, name: String, chat: Boolean, go: (Screen) -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
    Row(Modifier.clickable { go(Screen.Board) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        GIcon("back", Z9, 16.dp)
        Text("Board", color = Z9, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
    DisplayText(name.ifEmpty { " " }, size = 36.sp)
    TripChatToggle(id, name, chat, go)
}

// Trip and Chat side by side, styled like the board's filter.
@Composable
private fun TripChatToggle(id: String, name: String, chat: Boolean, go: (Screen) -> Unit) =
    Row(Modifier.fillMaxWidth().background(ZB.copy(alpha = .6f), RoundedCornerShape(12.dp)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((isChat, label) in listOf(false to "Trip", true to "Chat")) {
            Box(
                Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(9.dp)).background(if (chat == isChat) Color.White else Color.Transparent)
                    .clickable(enabled = chat != isChat) { go(if (isChat) Screen.Chat(id, name) else Screen.BoardTrip(id)) },
                contentAlignment = Alignment.Center,
            ) { Text(label, color = if (chat == isChat) Z9 else ZM, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        }
    }

// A white card with a heading, as the web's .card.
@Composable
private fun Card(title: String? = null, content: @Composable ColumnScope.() -> Unit) = Column(
    Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).border(1.dp, ZB, RoundedCornerShape(12.dp)).padding(14.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
) {
    if (title != null) Text(title, color = Z9, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    content()
}

@Composable
private fun Kv(rows: List<Pair<String, String>>) = Column {
    rows.forEachIndexed { i, (k, v) ->
        if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(ZB))
        Row(Modifier.padding(vertical = 9.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(k, Modifier.width(100.dp), color = ZM, fontSize = 14.sp)
            Text(v, Modifier.weight(1f), color = Z9, fontSize = 15.sp)
        }
    }
}

@Composable
fun BoardTripScreen(id: String, go: (Screen) -> Unit) {
    val context = LocalContext.current
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(id, reload) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Api.get("/api/board/trips/$id") } }.onSuccess { detail = it; onCall = it.optBoolean("on_call") }
            delay(15_000)
        }
    }
    OpsPage {
        TripHeader(id, detail?.optJSONObject("user")?.optString("name").orEmpty(), chat = false, go)
        val d = detail ?: run { Text("Loading…", color = Muted); return@OpsPage }
        val t = d.getJSONObject("trip")
        val u = d.getJSONObject("user")
        fun s(o: JSONObject, k: String) = o.optString(k).takeUnless { o.isNull(k) || it.isEmpty() }
        val status = t.optString("status")
        val first = u.optString("name").substringBefore(' ')
        val back = t.optLong("return_by")
        val backText = "${android.text.format.DateFormat.format("EEE", back)} ${hhmm(back)}"
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row { Pill(status) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GIcon(ACTIVITY_ICON[t.optString("activity")] ?: "other", Z9, 18.dp, modifier = Modifier.padding(top = 2.dp))
                Text("${t.optString("line")} · back by $backText", color = Z9)
            }
        }
        GButton("Phone $first ${formatPhone(u.optString("phone"))}", Btn.Red, "phone") { context.call(u.optString("phone")) }
        ErrorBanner(work.error)
        val calls = d.optJSONArray("calls") ?: JSONArray()
        for (i in 0 until calls.length()) {
            val call = calls.getJSONObject(i)
            val cid = call.getString("id")
            Card(if (call.optString("kind") == "help") "Help call" else "Overdue call") {
                Text(
                    when {
                        !call.isNull("accepted_at") -> "Accepted by ${call.optString("accepted_name").ifEmpty { "someone" }}, ${hhmm(call.getLong("accepted_at"))}"
                        !call.isNull("closed_at") -> "Closed ${hhmm(call.getLong("closed_at"))}. Nobody accepted."
                        else -> "Open. Nobody has accepted yet."
                    },
                    color = Z9,
                )
                if (call.optBoolean("can_accept") || call.optBoolean("can_reject")) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (call.optBoolean("can_accept")) GButton("Accept", small = true, enabled = !work.busy, modifier = Modifier.weight(1f)) {
                        work.run(scope, { Api.post("/api/board/calls/$cid/accept") }) { reload++ }
                    }
                    if (call.optBoolean("can_reject")) GButton("Reject", Btn.Outline, small = true, enabled = !work.busy, modifier = Modifier.weight(1f)) {
                        confirm = "reject:$cid"
                    }
                }
                val lines = call.getJSONArray("lines")
                for (j in 0 until lines.length()) {
                    val l = lines.getJSONObject(j)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(hhmm(l.getLong("at")), color = ZM, fontFamily = Mono, fontSize = 13.sp)
                        Text(l.optString("text"), color = Z9, fontSize = 14.sp)
                    }
                }
            }
        }

        val positions = d.getJSONArray("positions")
        val p = if (positions.length() > 0) positions.getJSONObject(0) else null
        Card("Last position") {
            if (p == null) {
                Text("None yet.", color = ZM)
                if (!t.isNull("start_lat")) LinkText("Start point on the map") { context.showOnMap(t.getDouble("start_lat"), t.getDouble("start_lng"), "Start") }
            } else Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("%.5f, %.5f".format(p.getDouble("lat"), p.getDouble("lng")), color = Z9, fontFamily = Mono, fontSize = 14.sp)
                    val signal = s(p, "signal")?.let { if (it == "none") "No signal" else if (it == "online") "Signal" else it.uppercase() }
                    Text(listOfNotNull(ago(p.optLong("at")), s(p, "accuracy")?.let { "±${p.optInt("accuracy")} m" },
                        s(p, "altitude")?.let { "${p.optInt("altitude")} m up" }, s(p, "battery")?.let { "${p.optInt("battery")}%" }, signal).joinToString(" · "),
                        color = ZM, fontSize = 13.sp)
                }
                Row(Modifier.clickable { context.showOnMap(p.getDouble("lat"), p.getDouble("lng"), u.optString("name")) }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Map", color = Navy, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    GIcon("ext", Navy, 15.dp)
                }
            }
        }

        val checklist = runCatching { JSONArray(t.optString("checklist_json")) }.getOrNull()?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty()
        Card("Plan") {
            Kv(listOfNotNull(
                "Started" to "${android.text.format.DateFormat.format("EEE", t.optLong("start_at"))} ${hhmm(t.optLong("start_at"))}" + (s(t, "place")?.let { " at $it" } ?: ""),
                s(t, "destination_text")?.let { "Headed to" to it },
                s(t, "route_text")?.let { "Route" to it },
                "Back by" to backText,
                s(t, "battery_at_start")?.let { "Battery at start" to "${t.optInt("battery_at_start")}%" },
                checklist.takeIf { it.isNotEmpty() }?.let { "Checklist" to it.joinToString("\n") },
            ))
        }
        val companions = d.getJSONArray("companions")
        Card("With them · ${(0 until companions.length()).count { companions.getJSONObject(it).optString("kind") != "pet" }}") {
            if (companions.length() == 0) Text("Alone", color = ZM)
            for (i in 0 until companions.length()) {
                val c = companions.getJSONObject(i)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(36.dp).background(NavyT, CircleShape), contentAlignment = Alignment.Center) {
                        if (c.optString("kind") == "pet") GIcon("paw", Navy, 18.dp) else Text(initials(c.optString("name")), color = Navy, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(c.optString("name"), color = Z9, fontWeight = FontWeight.Bold)
                        Text(if (c.optString("kind") == "pet") "Pet" else s(c, "phone")?.let(::formatPhone) ?: "No number given", color = ZM, fontSize = 13.sp)
                    }
                    s(c, "phone")?.let { ph ->
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, ZB, RoundedCornerShape(10.dp)).clickable { context.call(ph) },
                            contentAlignment = Alignment.Center) { GIcon("phone", Navy, 20.dp) }
                    }
                }
            }
        }
        val photos = listOfNotNull(s(t, "photo_key")?.let { it to "Full-body photo" }, s(t, "gear_photo_key")?.let { it to "Gear photo" }, s(t, "shoe_photo_key")?.let { it to "Shoe sole photo" })
        Card("Photos") {
            if (photos.isEmpty()) Text("No photos.", color = ZM)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((key, label) in photos) Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    AuthImage("/photos/$key", Modifier.fillMaxWidth().aspectRatio(.66f).clip(RoundedCornerShape(10.dp)).background(ZA))
                    Text(label, color = ZM, fontSize = 12.sp)
                }
            }
        }
        Card("Person") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(64.dp).clip(CircleShape).background(NavyT), contentAlignment = Alignment.Center) {
                    val key = s(u, "photo_key")
                    if (key != null) AuthImage("/photos/$key", Modifier.fillMaxSize()) else GIcon("user", Navy, 28.dp)
                }
                Column {
                    Text(u.optString("name"), color = Z9, fontWeight = FontWeight.Bold)
                    Text(s(u, "email").orEmpty(), color = ZM, fontSize = 13.sp)
                }
            }
            val age = s(u, "birthday")?.take(4)?.toIntOrNull()?.let { java.util.Calendar.getInstance().get(java.util.Calendar.YEAR) - it }
            val facts = listOfNotNull(age?.let { "Age" to "$it" }, s(u, "gender")?.let { "Gender" to it },
                s(u, "language")?.let { "Language" to (mapOf("en" to "English", "de" to "German", "nl" to "Dutch", "fr" to "French", "es" to "Spanish", "it" to "Italian", "pt" to "Portuguese", "zh" to "Mandarin")[it] ?: it) },
                s(u, "height_cm")?.let { "Height" to "$it cm" }, s(u, "weight_kg")?.let { "Weight" to "$it kg" }, s(u, "shoe_size")?.let { "Shoe" to "UK $it" },
                s(u, "blood_type")?.let { "Blood type" to it })
            for (row in facts.chunked(3)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((k, v) in row) Column(Modifier.weight(1f).background(ZA, RoundedCornerShape(10.dp)).padding(10.dp)) {
                    Text(k, color = ZM, fontSize = 12.sp)
                    Text(v, color = Z9, fontWeight = FontWeight.Bold)
                }
                repeat(3 - row.size) { Box(Modifier.weight(1f)) }
            }
            val aid = listOfNotNull(s(u, "medical_aid"), s(u, "medical_aid_plan"), s(u, "medical_aid_number")?.let { "no. $it" }).joinToString(", ")
            val medical = listOfNotNull(s(u, "allergies")?.let { "Allergies" to it }, s(u, "conditions")?.let { "Conditions" to it },
                s(u, "medication")?.let { "Medication" to it }, aid.ifEmpty { null }?.let { "Medical aid" to it })
            if (medical.isNotEmpty()) Kv(medical)
        }
        Card("Emergency contact") {
            val em = s(u, "emergency_name")
            if (em == null) Text("None given.", color = ZM)
            else Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(em + (s(u, "emergency_relation")?.let { " (${it.lowercase()})" } ?: ""), color = Z9, fontWeight = FontWeight.Bold)
                    s(u, "emergency_phone")?.let { Text(formatPhone(it), color = ZM, fontSize = 13.sp) }
                }
                s(u, "emergency_phone")?.let { ph ->
                    Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, ZB, RoundedCornerShape(10.dp)).clickable { context.call(ph) },
                        contentAlignment = Alignment.Center) { GIcon("phone", Navy, 20.dp) }
                }
            }
        }
        if (status != "closed") {
            Card("Siren") {
                Text("Makes $first's phone sound loudly, even on silent, so searchers nearby can hear it." +
                    (if (!t.isNull("siren_at")) " Last sounded ${hhmm(t.getLong("siren_at"))}." else ""), color = ZM, fontSize = 14.sp)
                GButton("Sound the siren", small = true, modifier = Modifier.fillMaxWidth()) { confirm = "siren" }
            }
            Card("Close trip") {
                Text("Only close once you know $first is safe or the search is handed over.", color = ZM, fontSize = 14.sp)
                GButton("Close trip", small = true, modifier = Modifier.fillMaxWidth()) { confirm = "close" }
            }
        }
    }
    confirm?.let { what ->
        if (what.startsWith("reject:")) {
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("Reject this call?") },
                text = { Text("It passes to the next person on call straight away, and you won't be able to accept it later.") },
                confirmButton = {
                    TextButton({
                        confirm = null
                        work.run(scope, { Api.post("/api/board/calls/${what.removePrefix("reject:")}/reject") }) { reload++ }
                    }) { Text("Reject") }
                },
                dismissButton = { TextButton({ confirm = null }) { Text("Cancel") } },
            )
            return@let
        }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (what == "siren") "Sound the siren?" else "Close this trip?") },
            text = { Text(if (what == "siren") "The phone rings loudly for up to three minutes." else "Only close once you know they're safe or the search is handed over.") },
            confirmButton = {
                TextButton({
                    confirm = null
                    work.run(scope, { Api.post("/api/board/trips/$id/$what") }) { if (what == "close") go(Screen.Board) else reload++ }
                }) { Text(if (what == "siren") "Sound it" else "Close trip") }
            },
            dismissButton = { TextButton({ confirm = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun OnCallScreen(go: (Screen) -> Unit) {
    var s by remember { mutableStateOf<JSONObject?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var adding by remember { mutableStateOf(false) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(reload) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Api.get("/api/oncall") } }.onSuccess { s = it; onCall = it.getJSONObject("me").optBoolean("on_call") }
            delay(30_000)
        }
    }
    // The reply is the new state. Set it after the IO thread is done, on the main thread.
    fun change(path: String, body: JSONObject) {
        var reply: JSONObject? = null
        work.run(scope, { reply = Api.post(path, body) }) { reply?.let { s = it; onCall = it.getJSONObject("me").optBoolean("on_call") } }
    }
    fun at(ms: Long) = "${android.text.format.DateFormat.format("EEE", ms)} ${hhmm(ms)}"
    OpsPage {
        DisplayText("On call")
        val st = s ?: run { Text("Loading…", color = Muted); return@OpsPage }
        val admin = Store.role == "admin"
        val now = st.optJSONObject("on_now")
        val me = st.getJSONObject("me")
        ErrorBanner(work.error)
        Card("On call now") {
            if (now == null) Text("Nobody is on call. Alerts go to every operator and admin.", color = Z9)
            else Text(now.optString("name") + (if (st.isNull("until")) ", with nobody else available to take over" else " until ${at(st.getLong("until"))}"),
                color = Z9, fontWeight = FontWeight.Bold)
            st.optJSONObject("next")?.takeIf { !st.isNull("until") }?.let { Text("Next: ${it.optString("name")} from ${at(st.getLong("until"))}", color = ZM) }
            val h = st.optInt("shift_hours")
            Text("Shifts of $h ${if (h == 1) "hour" else "hours"} from 06:00. An alert passes to the next person after ${st.optInt("no_response_minutes")} min with no answer.",
                color = ZM, fontSize = 13.sp)
        }
        if (me.optBoolean("on_roster")) Card("You") {
            val avail = me.optBoolean("available")
            Text(if (avail) "You're available. Alerts can come to you." else "You're unavailable. You're skipped until you switch back.", color = Z9)
            GButton(if (avail) "Make me unavailable" else "Make me available", if (avail) Btn.Outline else Btn.Navy, small = true, enabled = !work.busy) {
                change("/api/oncall/availability", JSONObject().put("available", if (avail) "0" else "1"))
            }
        }
        val roster = st.getJSONArray("roster")
        Card("Order · ${roster.length()}") {
            if (roster.length() == 0) Text("Nobody is on the list yet.", color = ZM)
            for (i in 0 until roster.length()) {
                val r = roster.getJSONObject(i)
                val id = r.getString("user_id")
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(r.optString("name"), color = Z9, fontWeight = FontWeight.Bold)
                    Text((if (r.optBoolean("on_now")) "On call now" else if (r.optBoolean("available")) "Available" else "Unavailable") +
                        (if (r.optInt("devices") == 0) " · No device gets alerts" else ""), color = if (r.optInt("devices") == 0) RedInk else ZM, fontSize = 13.sp)
                    if (admin) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        GButton("↑", Btn.Outline, small = true, enabled = !work.busy && i > 0, modifier = Modifier.weight(1f)) {
                            change("/api/oncall/move", JSONObject().put("user_id", id).put("dir", "up"))
                        }
                        GButton("↓", Btn.Outline, small = true, enabled = !work.busy && i < roster.length() - 1, modifier = Modifier.weight(1f)) {
                            change("/api/oncall/move", JSONObject().put("user_id", id).put("dir", "down"))
                        }
                        GButton(if (r.optBoolean("available")) "Unavailable" else "Available", Btn.Outline, small = true, enabled = !work.busy, modifier = Modifier.weight(2f)) {
                            change("/api/oncall/availability", JSONObject().put("user_id", id).put("available", if (r.optBoolean("available")) "0" else "1"))
                        }
                        GButton("", Btn.Outline, "x", small = true, enabled = !work.busy, modifier = Modifier.weight(1f)) {
                            change("/api/oncall/remove", JSONObject().put("user_id", id))
                        }
                    }
                }
            }
            val candidates = st.optJSONArray("candidates") ?: JSONArray()
            if (admin && candidates.length() > 0) Box {
                GButton("Add someone", Btn.Outline, "plus", small = true, enabled = !work.busy) { adding = true }
                DropdownMenu(adding, { adding = false }) {
                    for (i in 0 until candidates.length()) {
                        val u = candidates.getJSONObject(i)
                        DropdownMenuItem({ Text(u.optString("name")) }, { adding = false; change("/api/oncall/add", JSONObject().put("user_id", u.getString("user_id"))) })
                    }
                }
            }
        }
    }
}

// A photo from the server, which needs the bearer token, so no image library. Kept in memory once loaded.
private val images = HashMap<String, ImageBitmap>()

@Composable
fun AuthImage(path: String, modifier: Modifier) {
    val bmp by produceState(images[path], path) {
        if (value == null) value = withContext(Dispatchers.IO) {
            runCatching { Api.bytes(path).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull()
        }?.also { images[path] = it }
    }
    bmp?.let { Image(it, null, modifier, contentScale = ContentScale.Crop) } ?: Box(modifier)
}
