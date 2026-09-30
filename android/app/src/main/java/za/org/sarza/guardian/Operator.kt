package za.org.sarza.guardian

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun SignInScreen(link: String?, go: (Screen) -> Unit) {
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    fun verify(l: String) = work.run(scope, {
        val r = Api.post("/api/auth/verify", JSONObject().put("link", l.trim()))
        Store.signOut()
        Store.token = r.getString("token")
        Store.role = r.getJSONObject("user").getString("role")
    }) {
        Guardian.registerForPush(context)
        go(Screen.Board)
    }
    LaunchedEffect(link) { if (link != null) verify(link) }
    Page(Navy) {
        Title("SARZA operators", Color.White)
        if (link != null && work.busy) Text("Signing you in…", color = Color.White)
        if (!sent && link == null) {
            Text("We'll email you a sign-in link. Open it on this phone.", color = Color.White)
            Field("Your SARZA email", email, { email = it }, KeyboardType.Email)
            BigButton(if (work.busy) "Sending…" else "Email me a link", Red, !work.busy) {
                work.run(scope, { Api.post("/auth/link", JSONObject().put("email", email.trim())) }) { sent = true }
            }
        } else if (sent) {
            Text("Check your email and tap the link on this phone. It works once, for 15 minutes.", color = Color.White, fontSize = 17.sp)
            Text("If it opens in the browser instead, copy the link and paste it here.", color = Color.White)
            Field("Sign-in link", pasted, { pasted = it })
            BigButton("Sign in", Red, !work.busy && pasted.isNotBlank()) { verify(pasted) }
        }
        ErrorText(work.error)
    }
}

private val statusColor = mapOf("help" to Red, "overdue" to Color(0xFFB58800), "active" to Navy)

@Composable
fun BoardScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    var trips by remember { mutableStateOf<JSONArray?>(null) }
    var offline by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val work = rememberWork()
    LaunchedEffect(Unit) {
        Guardian.registerForPush(context)
        while (true) {
            val r = withContext(Dispatchers.IO) { runCatching { Api.get("/api/board").getJSONArray("trips") } }
            r.onSuccess { trips = it }
            offline = r.isFailure
            if ((r.exceptionOrNull() as? Api.Failed)?.status == 401) { Store.signOut(); go(Screen.Welcome); return@LaunchedEffect }
            delay(30_000)
        }
    }
    Page {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Title("Open trips") }
            TextButton({ work.run(scope, { runCatching { Api.post("/api/logout") } }) { Store.signOut(); go(Screen.Welcome) } }) { Text("Sign out") }
        }
        if (offline) Text("No connection. Showing what we had.", color = Red)
        val list = trips
        if (list == null) Text("Loading…", color = Muted)
        else if (list.length() == 0) Text("No open trips.", color = Muted)
        else for (status in listOf("help", "overdue", "active")) {
            val group = (0 until list.length()).map { list.getJSONObject(it) }.filter { it.optString("status") == status }
            if (group.isEmpty()) continue
            Heading("$status · ${group.size}")
            for (t in group) TripRow(t) { go(Screen.BoardTrip(t.getString("id"))) }
        }
    }
}

@Composable
private fun TripRow(t: JSONObject, onClick: () -> Unit) {
    val last = t.optJSONObject("last")
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(t.optString("user_name"), fontWeight = FontWeight.Bold, fontSize = 18.sp, color = statusColor[t.optString("status")] ?: Navy)
        Text(t.optString("line"))
        Text("Back by ${hhmm(t.optLong("return_by"))} ${dayWord(t.optLong("return_by")).lowercase()}", color = Muted)
        Text(
            if (last == null) "No position yet"
            else "Last fix ${ago(last.optLong("at"))}" + (if (!last.isNull("battery")) ", battery ${last.optInt("battery")}%" else ""),
            color = Muted,
        )
    }
}

@Composable
fun BoardTripScreen(id: String, go: (Screen) -> Unit) {
    val context = LocalContext.current
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    suspend fun load() = withContext(Dispatchers.IO) { runCatching { Api.get("/api/board/trips/$id") } }.onSuccess { detail = it }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(id, reload) { while (true) { load(); delay(15_000) } }
    Page {
        TextButton({ go(Screen.Board) }) { Text("‹ Open trips") }
        val d = detail ?: run { Text("Loading…", color = Muted); return@Page }
        val t = d.getJSONObject("trip")
        val u = d.getJSONObject("user")
        fun s(o: JSONObject, k: String) = o.optString(k).takeUnless { o.isNull(k) || it.isEmpty() }
        val status = t.optString("status")
        Title(u.optString("name"), statusColor[status] ?: Navy)
        Text(status.uppercase(), color = statusColor[status] ?: Navy, fontWeight = FontWeight.Bold)
        Text(t.optString("line"), fontSize = 17.sp)
        Text("Back by ${hhmm(t.optLong("return_by"))} ${dayWord(t.optLong("return_by")).lowercase()}", fontWeight = FontWeight.SemiBold)
        BigButton("Phone ${u.optString("name").substringBefore(' ')}") { context.call(u.optString("phone")) }

        Heading("Last position")
        val positions = d.getJSONArray("positions")
        if (positions.length() == 0) {
            Text("None yet.", color = Muted)
            if (!t.isNull("start_lat")) OutlinedButton({ context.showOnMap(t.getDouble("start_lat"), t.getDouble("start_lng"), "Start") }) { Text("Start point on the map") }
        } else {
            val p = positions.getJSONObject(0)
            Text(
                "${ago(p.optLong("at"))} at ${hhmm(p.optLong("at"))}" +
                    (if (!p.isNull("accuracy")) ", ±${p.optInt("accuracy")} m" else "") +
                    (if (!p.isNull("altitude")) ", ${p.optInt("altitude")} m up" else "") +
                    (if (!p.isNull("battery")) ", battery ${p.optInt("battery")}%" else ""),
            )
            OutlinedButton({ context.showOnMap(p.getDouble("lat"), p.getDouble("lng"), u.optString("name")) }) { Text("Open in Maps") }
        }

        Heading("Plan")
        for ((label, key) in listOf("Headed to" to "destination_text", "Route" to "route_text", "Started at" to "place", "Wearing" to "wearing_text")) {
            s(t, key)?.let { Text("$label: $it") }
        }
        val companions = d.getJSONArray("companions")
        for (i in 0 until companions.length()) {
            val c = companions.getJSONObject(i)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text((if (c.optString("kind") == "pet") "🐾 " else "With ") + c.optString("name"), Modifier.weight(1f))
                s(c, "phone")?.let { ph -> TextButton({ context.call(ph) }) { Text("Phone") } }
            }
        }

        Heading("Emergency contact")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(listOfNotNull(s(u, "emergency_name"), s(u, "emergency_relation")).joinToString(", ").ifEmpty { "None given" }, Modifier.weight(1f))
            s(u, "emergency_phone")?.let { ph -> TextButton({ context.call(ph) }) { Text("Phone") } }
        }
        val medical = listOf("Allergies" to "allergies", "Conditions" to "conditions", "Medication" to "medication", "Blood type" to "blood_type")
            .mapNotNull { (l, k) -> s(u, k)?.let { "$l: $it" } }
        if (medical.isNotEmpty()) {
            Heading("Medical")
            medical.forEach { Text(it) }
        }

        if (status != "closed") {
            Heading("Siren")
            Text("Makes the phone sound loudly, even on silent, so searchers nearby can hear it." +
                (if (!t.isNull("siren_at")) " Last sounded ${hhmm(t.getLong("siren_at"))}." else ""), color = Muted)
            BigButton("Sound the siren", Red) { confirm = "siren" }
        }
        ErrorText(work.error)
        Chat(id, Navy)
        if (status != "closed") TextButton({ confirm = "close" }) { Text("Close trip", color = Red) }
    }
    confirm?.let { what ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (what == "siren") "Sound the siren?" else "Close this trip?") },
            text = { Text(if (what == "siren") "The phone rings loudly for up to three minutes." else "Only close once you know they're safe or the search is handed over.") },
            confirmButton = {
                TextButton({
                    confirm = null
                    work.run(scope, { Api.post("/api/board/trips/$id/${what}") }) { if (what == "close") go(Screen.Board) else reload++ }
                }) { Text(if (what == "siren") "Sound it" else "Close trip") }
            },
            dismissButton = { TextButton({ confirm = null }) { Text("Cancel") } },
        )
    }
}
