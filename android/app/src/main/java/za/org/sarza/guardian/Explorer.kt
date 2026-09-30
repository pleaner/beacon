@file:OptIn(ExperimentalLayoutApi::class)

package za.org.sarza.guardian

import android.Manifest
import android.annotation.SuppressLint
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
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
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar

@Composable
fun WelcomeScreen(go: (Screen) -> Unit) = Page(Navy) {
    Title("Guardian", Color.White)
    Text("by SARZA", color = Yellow, fontWeight = FontWeight.Bold)
    Text(
        "Tell us where you're going and when you'll be back. If you don't come back, SARZA knows where to start looking.",
        color = Color.White, fontSize = 17.sp,
    )
    BigButton("Get started", Red) { go(Screen.Profile) }
    TextButton({ go(Screen.SignIn(null)) }) { Text("I'm a SARZA operator", color = Color.White) }
}

@Composable
fun ProfileScreen(go: (Screen) -> Unit) {
    val u = Store.me?.optJSONObject("user") ?: JSONObject()
    fun s(k: String) = u.optString(k).takeUnless { u.isNull(k) }.orEmpty()
    var name by remember { mutableStateOf(s("name")) }
    var country by remember { mutableStateOf("27") }
    var phone by remember { mutableStateOf(s("phone")) }
    var email by remember { mutableStateOf(s("email")) }
    var emName by remember { mutableStateOf(s("emergency_name")) }
    var emPhone by remember { mutableStateOf(s("emergency_phone")) }
    var allergies by remember { mutableStateOf(s("allergies")) }
    var conditions by remember { mutableStateOf(s("conditions")) }
    var medication by remember { mutableStateOf(s("medication")) }
    var blood by remember { mutableStateOf(s("blood_type")) }
    var consent by remember { mutableStateOf(u.optInt("consent_contact", 1) == 1) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    Page {
        Title(if (Store.token == null) "About you" else "Your profile")
        Text("SARZA sees this only if you need help.", color = Muted)
        Field("Your name", name, { name = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.width(96.dp)) { Field("Code", country, { country = it.filter(Char::isDigit) }, KeyboardType.Phone) }
            Column(Modifier.weight(1f)) { Field("Mobile number", phone, { phone = it }, KeyboardType.Phone) }
        }
        Field("Email", email, { email = it }, KeyboardType.Email)
        Heading("Emergency contact")
        Field("Their name", emName, { emName = it })
        Field("Their number", emPhone, { emPhone = it }, KeyboardType.Phone)
        Row(Modifier.toggleable(consent) { consent = it }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(consent, null)
            Text("SARZA may phone them if they can't reach me")
        }
        Heading("Medical")
        Text("Optional. It helps the people who come to find you.", color = Muted)
        Field("Allergies", allergies, { allergies = it })
        Field("Conditions", conditions, { conditions = it })
        Field("Medication", medication, { medication = it })
        Text("Blood type", color = Muted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (b in listOf("O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-")) FilterChip(blood == b, { blood = if (blood == b) "" else b }, { Text(b) })
        }
        ErrorText(work.error)
        BigButton(if (work.busy) "Saving…" else "Save", enabled = !work.busy) {
            val body = JSONObject()
                .put("name", name).put("phone", phone).put("phone_country", country).put("email", email)
                .put("emergency_name", emName).put("emergency_phone", emPhone).put("emergency_phone_country", country)
                .put("allergies", allergies).put("conditions", conditions).put("medication", medication).put("blood_type", blood)
            if (consent) body.put("consent_contact", "1")
            work.run(scope, {
                val r = Api.post("/api/profile", body)
                if (Store.token == null) { Store.token = r.getString("token"); Store.role = "explorer" }
                Store.me = Api.get("/api/me")
            }) {
                Guardian.registerForPush(context)
                go(Screen.Home)
            }
        }
    }
}

@Composable
fun HomeScreen(go: (Screen) -> Unit) {
    var me by remember { mutableStateOf(Store.me) }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) { runCatching { Store.me = Api.get("/api/me") } }
        me = Store.me
        if (Store.trip != null) go(Screen.Trip)
    }
    val activities = me?.optJSONObject("activities") ?: JSONObject()
    Page {
        Title("Hi ${me?.optJSONObject("user")?.optString("name")?.substringBefore(' ').orEmpty()}")
        Text("What are you doing today?", color = Muted, fontSize = 17.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (key in activities.keys()) {
                OutlinedButton({ go(Screen.NewTrip(key)) }) { Text(activities.getString(key), fontSize = 17.sp) }
            }
        }
        TextButton({ go(Screen.Profile) }) { Text("Edit your profile") }
    }
}

// The start point, from GPS while the form is open.
@SuppressLint("MissingPermission")
@Composable
fun rememberFix(allowed: Boolean): Location? {
    val context = LocalContext.current
    var fix by remember { mutableStateOf<Location?>(null) }
    DisposableEffect(allowed) {
        val lm = context.getSystemService(LocationManager::class.java)
        val listener = LocationListener { l -> if (fix == null || l.accuracy <= (fix!!.accuracy + 10) || l.time - fix!!.time > 60_000) fix = l }
        if (allowed) {
            for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(p)) continue
                lm.getLastKnownLocation(p)?.takeIf { System.currentTimeMillis() - it.time < 120_000 }?.let(listener::onLocationChanged)
                runCatching { lm.requestLocationUpdates(p, 2_000L, 0f, listener) }
            }
        }
        onDispose { lm.removeUpdates(listener) }
    }
    return fix
}

@Composable
fun NewTripScreen(initial: String, go: (Screen) -> Unit) {
    val context = LocalContext.current
    val me = Store.me ?: JSONObject()
    val activities = me.optJSONObject("activities") ?: JSONObject()
    var activity by remember { mutableStateOf(initial) }
    var activityText by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var route by remember { mutableStateOf("") }
    var alone by remember { mutableStateOf(false) }
    val people = remember { mutableStateListOf<Pair<String, String>>() }
    val savedPets = me.optJSONArray("pets")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty()
    val pets = remember { mutableStateListOf<String>() }
    var back by remember { mutableLongStateOf(0L) }
    val battery = remember { TripService.battery(context) }
    val items = me.optJSONObject("checklists")?.optJSONArray(activity)?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty()
    val ticked = remember(activity) { mutableStateListOf<String>().apply { addAll(items.filter { it.startsWith("Phone battery") && battery > 50 }) } }
    val photos = remember { mutableStateOf(mapOf<String, File>()) }
    var granted by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        granted = r[Manifest.permission.ACCESS_FINE_LOCATION] == true || r[Manifest.permission.ACCESS_COARSE_LOCATION] == true
    }
    LaunchedEffect(Unit) {
        ask.launch(buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION); add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.toTypedArray())
    }
    val fix = rememberFix(granted)
    var place by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(fix != null) {
        val f = fix ?: return@LaunchedEffect
        place = withContext(Dispatchers.IO) { runCatching { Api.get("/api/place?lat=${f.latitude}&lng=${f.longitude}").optString("place").ifEmpty { null } }.getOrNull() }
    }
    var shooting by remember { mutableStateOf<Pair<String, File>?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val (key, file) = shooting ?: return@rememberLauncherForActivityResult
        if (ok && shrink(file)) photos.value += key to file
    }
    fun shoot(key: String) {
        val file = File(context.cacheDir, "photos/$key.jpg").apply { parentFile?.mkdirs() }
        shooting = key to file
        camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.files", file))
    }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val gear = mapOf("paraglide" to "Your wing", "mtb" to "Your bike")[activity]

    Page {
        TextButton({ go(Screen.Home) }) { Text("‹ Back") }
        Title("Your trip")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (key in activities.keys()) FilterChip(activity == key, { activity = key }, { Text(activities.getString(key)) })
        }
        if (activity == "other") Field("What are you doing?", activityText, { activityText = it })

        Heading("Where")
        Text(
            when {
                !granted -> "Guardian needs your location to record where you start."
                fix == null -> "Finding you…"
                else -> "Starting at ${place ?: "%.4f, %.4f".format(fix.latitude, fix.longitude)} (±${fix.accuracy.toInt()} m)"
            },
            color = if (fix == null) Red else Green, fontWeight = FontWeight.SemiBold,
        )
        Field("Where are you headed?", destination, { destination = it })
        Field("Your route", route, { route = it }, lines = 3)

        Heading("Who's with you")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(alone, { alone = it })
            Text("  I'm going alone")
        }
        if (!alone) {
            people.forEachIndexed { i, (n, p) ->
                Field("Name", n, { people[i] = it to p })
                Field("Their number (optional)", p, { people[i] = n to it }, KeyboardType.Phone)
            }
            TextButton({ people.add("" to "") }) { Text("+ Add someone") }
        }
        if (savedPets.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (p in savedPets) FilterChip(p in pets, { if (p in pets) pets.remove(p) else pets.add(p) }, { Text("🐾 $p") })
        }

        Heading("Back by")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (h in listOf(2, 4, 6, 8)) OutlinedButton({ back = roundUp(System.currentTimeMillis() + h * 3_600_000L) }) { Text("+$h h") }
            OutlinedButton({ pickTime(context, back) { back = it } }) { Text("Pick a time") }
        }
        if (back > 0) Text("${dayWord(back)} at ${hhmm(back)}, in ${duration(back - System.currentTimeMillis())}", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(
            "If you're not back by then, we'll ask if you're okay. No answer after ${me.optInt("grace_minutes", 30)} minutes, and SARZA is alerted.",
            color = Muted,
        )

        if (items.isNotEmpty()) {
            Heading("Checklist")
            Text("Your phone battery is at $battery%.", color = if (battery < 50) Red else Muted)
            for (item in items) Row(
                Modifier.fillMaxWidth().toggleable(item in ticked) { if (it) ticked.add(item) else ticked.remove(item) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(item in ticked, null)
                Text(item)
            }
        }

        Heading("Photos")
        Text("Searchers use these to know who and what to look for.", color = Muted)
        for ((key, label) in listOfNotNull("photo" to "You, head to toe, as you're dressed today", "shoe_photo" to "The sole of your shoe", gear?.let { "gear_photo" to it })) {
            OutlinedButton({ shoot(key) }, Modifier.fillMaxWidth()) { Text((if (key in photos.value) "✓ " else "📷 ") + label) }
        }

        ErrorText(work.error)
        BigButton(if (work.busy) "Starting…" else "Start trip", enabled = !work.busy) {
            work.error = when {
                activity == "other" && activityText.isBlank() -> "Tell us what you're doing."
                destination.isBlank() || route.isBlank() -> "Tell us where you're headed and your route."
                fix == null -> "We need your location. Step outside if you can, and wait a moment."
                back <= System.currentTimeMillis() -> "Pick when you'll be back."
                else -> null
            }
            if (work.error != null) return@BigButton
            val f = fix!!
            val fields = buildList {
                add("activity" to activity); add("activity_text" to activityText); add("destination_text" to destination); add("route_text" to route)
                add("company" to if (alone) "alone" else "group")
                for ((n, p) in people) if (n.isNotBlank()) { add("companion_name" to n); add("companion_phone" to p); add("companion_phone_country" to "27") }
                for (p in pets) add("pet_name" to p)
                add("return_by" to back.toString())
                add("start_lat" to f.latitude.toString()); add("start_lng" to f.longitude.toString()); add("start_accuracy" to f.accuracy.toString())
                add("battery" to battery.toString())
                for (t in ticked) add("checklist" to t)
            }
            work.run(scope, {
                Api.multipart("/api/trips", fields, photos.value.toList())
                Store.me = Api.get("/api/me")
                Store.clearQueue()
            }) {
                askBatteryExemption(context)
                TripService.start(context)
                go(Screen.Trip)
            }
        }
    }
}

// Samsung, Xiaomi and friends kill background work to save battery. Ask to be left alone for the trip.
@SuppressLint("BatteryLife")
fun askBatteryExemption(c: Context) {
    if (c.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(c.packageName)) return
    runCatching { c.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${c.packageName}"))) }
}

fun roundUp(ms: Long) = Calendar.getInstance().apply {
    timeInMillis = ms
    set(Calendar.MINUTE, (get(Calendar.MINUTE) + 4) / 5 * 5)
    set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
}.timeInMillis

fun dayWord(ms: Long): String {
    val day = { t: Long -> Calendar.getInstance().apply { timeInMillis = t }.get(Calendar.DAY_OF_YEAR) }
    val now = System.currentTimeMillis()
    return when (day(ms)) {
        day(now) -> "Today"
        day(now + 86_400_000) -> "Tomorrow"
        else -> android.text.format.DateFormat.format("EEE d MMM", ms).toString()
    }
}

fun pickTime(c: Context, current: Long, set: (Long) -> Unit) {
    val cal = Calendar.getInstance().apply { timeInMillis = if (current > 0) current else System.currentTimeMillis() + 3 * 3_600_000L }
    DatePickerDialog(c, { _, y, m, d ->
        TimePickerDialog(c, { _, h, min ->
            cal.set(y, m, d, h, min, 0)
            set(cal.timeInMillis)
        }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).show()
    }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).apply { datePicker.minDate = System.currentTimeMillis() - 1000 }.show()
}

// Photos go up at 1600 px at most, turned the right way up, so they get through on a weak signal.
fun shrink(file: File): Boolean = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
    var bmp = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
    val scale = 1600f / maxOf(bmp.width, bmp.height)
    val m = Matrix()
    if (scale < 1) m.postScale(scale, scale)
    when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
    }
    bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    file.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
    true
}.getOrDefault(false)

@Composable
fun TripScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    var trip by remember { mutableStateOf(Store.trip) }
    var pending by remember { mutableStateOf(Store.helpPending) }
    var queued by remember { mutableStateOf(Store.queue().length()) }
    var confirmBack by remember { mutableStateOf(false) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Store.me = Api.get("/api/me") } }
            trip = Store.trip
            pending = Store.helpPending
            queued = Store.queue().length()
            if (trip == null) { TripService.stop(context); go(Screen.Home); return@LaunchedEffect }
            delay(if (trip?.optString("status") == "help" || pending != null) 5_000 else 15_000)
        }
    }
    val t = trip ?: return
    val id = t.getString("id")
    val status = t.optString("status")
    val backBy = t.optLong("return_by")
    val sms = Store.me?.optString("sms_number")?.takeIf { it.isNotEmpty() && it != "null" }
    val emergency = Store.me?.optString("emergency_phone").orEmpty()

    if (status == "help" || pending != null) {
        Page(Red) {
            Title(if (status == "help") "SARZA has been alerted" else "Calling SARZA…", Color.White)
            Text(
                if (status == "help") "Stay where you are if it's safe. We have your trip plan and your last position."
                else if (!TripService.online(context)) "No signal right now. We'll send it the moment you have signal. If it's safe where you are, stay put."
                else "Sending your call for help…",
                color = Color.White, fontSize = 17.sp,
            )
            BigButton("Phone SARZA", Navy) { context.call(emergency) }
            if (sms != null && status != "help") BigButton("Text SARZA", Navy) {
                val last = Store.queue().let { q -> if (q.length() > 0) q.getJSONObject(q.length() - 1) else null }
                val where = last?.let { " Position %.5f, %.5f.".format(it.getDouble("lat"), it.getDouble("lng")) }.orEmpty()
                context.open("sms:$sms?body=" + Uri.encode("Help needed. ${Store.me?.optJSONObject("user")?.optString("name")}.$where"))
            }
            ErrorText(work.error)
            TextButton({
                if (status == "help") work.run(scope, { Api.post("/api/trips/$id/cancel"); Store.me = Api.get("/api/me") }) { trip = Store.trip }
                else { Store.helpPending = null; pending = null }
            }) { Text("Cancel, I'm fine", color = Color.White, fontSize = 16.sp) }
            Chat(id, Color.White)
        }
        return
    }

    val overdue = status == "overdue" || backBy < System.currentTimeMillis()
    Page {
        Title(if (overdue) "Are you okay?" else "Trip in progress", if (overdue) Red else Navy)
        Text(
            if (overdue) "You were due back at ${hhmm(backBy)}. Say you're safe, or add more time."
            else "Back by ${hhmm(backBy)} ${dayWord(backBy).lowercase()}, ${duration(backBy - System.currentTimeMillis())} left.",
            fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
        )
        Text(t.optString("destination_text"), color = Muted)
        if (queued > 0) Text("$queued positions waiting for signal.", color = Muted)
        BigButton("I'm back safe", Green) { confirmBack = true }
        Heading("Add time")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((label, min) in listOf("30 min" to 30, "1 h" to 60, "2 h" to 120, "4 h" to 240)) OutlinedButton({
                work.run(scope, {
                    val r = Api.post("/api/trips/$id/extend", JSONObject().put("minutes", min))
                    Store.updateTrip { it.put("return_by", r.getLong("return_by")).put("status", "active") }
                }) { trip = Store.trip; TripService.poke(context) }
            }) { Text("+$label") }
        }
        ErrorText(work.error)
        Heading("Need help?")
        SlideToConfirm("Slide to call SARZA", Red) {
            Store.helpPending = id
            pending = id
            TripService.poke(context)
        }
        Chat(id, Navy)
    }
    if (confirmBack) AlertDialog(
        onDismissRequest = { confirmBack = false },
        title = { Text("You're back safe?") },
        text = { Text("This ends your trip.") },
        confirmButton = {
            TextButton({
                confirmBack = false
                work.run(scope, { Api.post("/api/trips/$id/back"); Store.me = Api.get("/api/me") }) {
                    TripService.stop(context)
                    go(Screen.Home)
                }
            }) { Text("Yes, I'm back") }
        },
        dismissButton = { TextButton({ confirmBack = false }) { Text("Not yet") } },
    )
}

// Messages between the explorer and SARZA. Operators and explorers both use it.
@Composable
fun Chat(tripId: String, ink: Color) {
    var messages by remember { mutableStateOf(JSONArray()) }
    var text by remember { mutableStateOf("") }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(tripId) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Api.get("/api/trips/$tripId/messages").getJSONArray("messages") } }.onSuccess { messages = it }
            delay(10_000)
        }
    }
    Heading("Messages", ink)
    for (i in 0 until messages.length()) {
        val m = messages.getJSONObject(i)
        val media = m.optString("media_type").takeIf { !m.isNull("media_type") }
        val body = m.optString("body").ifEmpty { if (media?.startsWith("audio/") == true) "(Voice note)" else "(Photo)" }
        Column(
            Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(12.dp),
        ) {
            Text("${m.optString("author_name")} · ${hhmm(m.optLong("created_at"))}", color = Muted, fontSize = 13.sp)
            Text(body, color = Color.Black)
        }
    }
    Column(Modifier.background(Color.White, RoundedCornerShape(4.dp))) { Field("Write a message", text, { text = it }, lines = 2) }
    ErrorText(work.error)
    TextButton({
        if (text.isBlank()) return@TextButton
        val sending = text
        work.run(scope, { messages = Api.post("/api/trips/$tripId/messages", JSONObject().put("body", sending)).getJSONArray("messages") }) { text = "" }
    }, enabled = !work.busy) { Text("Send", color = ink, fontWeight = FontWeight.Bold) }
}
