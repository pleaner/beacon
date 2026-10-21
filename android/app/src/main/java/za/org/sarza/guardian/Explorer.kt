@file:OptIn(ExperimentalLayoutApi::class)

package za.org.sarza.guardian

import android.Manifest
import android.annotation.SuppressLint
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import kotlin.math.abs

// ---------- welcome ----------

// Everyone signs in with Google, explorers and operators alike. The account's role picks the next screen.
@Composable
fun WelcomeScreen(go: (Screen) -> Unit) = Page(Navy, gap = 0.dp, top = 56.dp) {
    val context = LocalContext.current
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    fun signIn() {
        if (BuildConfig.GOOGLE_CLIENT_ID.isEmpty()) { work.error = "Google sign-in isn't set up in this build."; return }
        work.error = null
        scope.launch {
            val idToken = try {
                val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_CLIENT_ID).build()
                val r = CredentialManager.create(context).getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build())
                GoogleIdTokenCredential.createFrom(r.credential.data).idToken
            } catch (e: GetCredentialCancellationException) {
                return@launch
            } catch (e: Exception) {
                work.error = "Couldn't sign in with Google. Try again."
                return@launch
            }
            var newExplorer = false
            work.run(scope, {
                val r = Api.post("/api/auth/google", JSONObject().put("id_token", idToken))
                Store.signOut()
                Store.token = r.getString("token")
                Store.role = r.getJSONObject("user").getString("role")
                Store.me = JSONObject().put("user", r.getJSONObject("user"))
                newExplorer = r.optBoolean("needs_profile")
            }) {
                Guardian.registerForPush(context)
                go(if (newExplorer) Screen.Profile else MainActivity.home())
            }
        }
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Logo(132.dp)
        DisplayText("Guardian", Color.White, 44.sp, align = TextAlign.Center)
        Text(
            "File a plan before you head out. If you're not back when you expect to be, we'll check in on you. If you don't respond, or call for help, SARZA will help you get home safe.",
            color = Color.White.copy(alpha = .9f), fontSize = 16.sp, textAlign = TextAlign.Center,
        )
        Spacer(Modifier)
        ErrorBanner(work.error)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 58.dp).clip(RoundedCornerShape(14.dp)).background(Color.White)
                .clickable(enabled = !work.busy) { signIn() }.padding(horizontal = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(painterResource(R.drawable.google_g), null, Modifier.size(22.dp))
            Text(if (work.busy) "Signing you in…" else "Continue with Google", color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        Text("Turn a bad day into a great story.", color = Color.White.copy(alpha = .85f), fontSize = 14.sp)
    }
}

// ---------- home ----------

@Composable
fun HomeScreen(go: (Screen) -> Unit, notice: String? = null) {
    val context = LocalContext.current
    var me by remember { mutableStateOf(Store.me) }
    var alertsOff by remember { mutableStateOf(!notificationsOn(context)) }
    val askAlerts = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { alertsOff = !it }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) { runCatching { Store.me = Api.get("/api/me") } }
        me = Store.me
        if (Store.trip != null) go(Screen.Trip)
    }
    val activities = me?.optJSONObject("activities") ?: JSONObject()
    AppPage {
        DisplayText("Hi ${me?.optJSONObject("user")?.optString("name")?.substringBefore(' ').orEmpty()}", size = 44.sp)
        if (notice != null) Banner(NavyT) { Text(notice, fontWeight = FontWeight.SemiBold) }
        if (alertsOff) Banner(YellowT, Ink, "bell", YellowLine) {
            Text("Notifications are off, so we can't reach you when you're overdue.")
            GButton("Enable alerts", small = true) {
                if (Build.VERSION.SDK_INT >= 33) askAlerts.launch(Manifest.permission.POST_NOTIFICATIONS) else context.openAppSettings()
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("What are you doing today?", fontSize = 17.sp, fontWeight = FontWeight.Bold)
            val keys = activities.keys().asSequence().toList()
            for (row in keys.chunked(2)) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (key in row) Column(
                    Modifier.weight(1f).heightIn(min = 116.dp).clip(RoundedCornerShape(16.dp)).background(Color.White)
                        .border(1.5.dp, Line, RoundedCornerShape(16.dp)).clickable { go(Screen.NewTrip(key)) }.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                ) {
                    Box(Modifier.size(44.dp).background(NavyT, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        GIcon(ACTIVITY_ICON[key] ?: "other", Navy, 26.dp)
                    }
                    Text(activities.getString(key).uppercase(), fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 23.sp,
                        letterSpacing = .02.em, textAlign = TextAlign.Center)
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        Lead("Plan a trip and we'll check on you if you're not back in time.")
    }
}

fun notificationsOn(c: Context) = Build.VERSION.SDK_INT < 33 ||
    ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

fun Context.openAppSettings() = runCatching {
    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
}

// ---------- new trip (6 steps) ----------

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

private class Person(name: String = "", code: String = "27", phone: String = "") {
    var name by mutableStateOf(name)
    var code by mutableStateOf(code)
    var phone by mutableStateOf(phone)
}

@Composable
fun NewTripScreen(activity: String, go: (Screen) -> Unit) {
    val context = LocalContext.current
    val me = Store.me ?: JSONObject()
    val noun = ACTIVITY_NOUN[activity] ?: "trip"
    val activityName = me.optJSONObject("activities")?.optString(activity) ?: activity
    var step by remember { mutableIntStateOf(0) }
    var activityText by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var route by remember { mutableStateOf("") }
    var alone by remember { mutableStateOf(false) }
    val people = remember { mutableStateListOf(Person()) }
    val savedPets = me.optJSONArray("pets")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty()
    val pets = remember { mutableStateListOf<String>() }
    val newPets = remember { mutableStateListOf<String>() }
    var back by remember { mutableLongStateOf(roundUp(System.currentTimeMillis() + 4 * 3_600_000L)) }
    var plusHours by remember { mutableIntStateOf(4) }
    val battery = remember { TripService.battery(context) }
    val items = me.optJSONObject("checklists")?.optJSONArray(activity)?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty()
    val ticked = remember { mutableStateListOf<String>().apply { addAll(items.filter { it.startsWith("Phone battery") && battery > 50 }) } }
    var photos by remember { mutableStateOf(mapOf<String, File>()) }
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
    val shoot = rememberCamera { key, file -> photos = photos + (key to file) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val gear = mapOf("paraglide" to "Your wing", "mtb" to "Your bike")[activity]
    val group = !alone && people.any { it.name.isNotBlank() }
    val wear = when (activity) {
        "paraglide" -> "in your harness and helmet" to "in harnesses and helmets"
        "mtb" -> "in your helmet and kit" to "in helmets and kit"
        else -> "with your pack on" to "with packs on"
    }
    BackHandler { if (step > 0) step-- else go(Screen.Home) }

    fun start() {
        val f = fix ?: run { step = 1; work.error = "We need your location before you go. Step outside if you can, and wait a moment."; return }
        val fields = buildList {
            add("activity" to activity); add("activity_text" to activityText); add("destination_text" to destination); add("route_text" to route)
            add("company" to if (alone) "alone" else "group")
            if (!alone) for (p in people) if (p.name.isNotBlank()) { add("companion_name" to p.name); add("companion_phone" to p.phone); add("companion_phone_country" to p.code) }
            for (p in pets + newPets.filter { it.isNotBlank() }) add("pet_name" to p)
            add("return_by" to back.toString())
            add("start_lat" to f.latitude.toString()); add("start_lng" to f.longitude.toString()); add("start_accuracy" to f.accuracy.toString())
            add("battery" to battery.toString())
            for (t in ticked) add("checklist" to t)
        }
        work.run(scope, {
            Api.multipart("/api/trips", fields, photos.toList())
            Store.me = Api.get("/api/me")
            Store.clearQueue()
            Store.lastSent = null
        }) {
            askBatteryExemption(context)
            TripService.start(context)
            go(Screen.Trip)
        }
    }

    // Each step's check before Next, like the web's required fields.
    fun next() {
        work.error = when (step) {
            1 -> when {
                activity == "other" && activityText.isBlank() -> "Tell us what you're doing."
                destination.isBlank() || route.isBlank() -> "Tell us where you're headed and your route."
                fix == null -> "We need your location before you go. Step outside if you can, and wait a moment."
                else -> null
            }
            3 -> if (back <= System.currentTimeMillis()) "\"Back by\" must be a time in the future." else null
            else -> null
        }
        if (work.error == null) step++
    }

    val titles = listOf("How Guardian works", "Where are you going?", "Who's with you?", "When will you be back?", "Before you go", "What searchers look for")
    val leads = listOf("Take Guardian with you, turn a bad day into a great story.", null, null, null, "Tick what's true. Nothing here stops you starting.",
        "A quick photo helps us recognise you, and your footprints.")
    FlowPage(
        step, 6, titles[step], leads[step], onBack = { if (step > 0) step-- else go(Screen.Home) },
        trailing = { SlideCancel { go(Screen.Home) } },
        actions = {
            when (step) {
                0 -> GButton("Plan my $noun", icon = "arrow") { next() }
                5 -> GButton(if (work.busy) "Starting…" else "Start trip", Btn.Red, "arrow", enabled = !work.busy) { start() }
                else -> GButton("", icon = "arrow") { next() }
            }
        },
    ) {
        ErrorBanner(work.error)
        when (step) {
            0 -> {
                HowItem(1, "Tell us your plan", "Where you're going, who's with you, **when you're expecting to be back**, and a quick photo so we know what you're wearing.")
                HowItem(2, "We'll check in", "**If you're not back** by your expected time, we'll ask if you're okay. Answer, and that's the end of it.")
                HowItem(3, "We come looking", "We know who you are. We know what you want. We have a very particular set of skills. Skills we have acquired over very long careers. Skills that make us a lifeline for people like you. If you get home safe before the expected time, that'll be the end of it. We will not look for you, we will not pursue you, but if you don't, we will look for you, we will find you and **we will bring you home**.")
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Banner(Ground, Navy, "pin") { Text("During your $noun, we drop a pin every 2 minutes, so we know where you were last.") }
                    Banner(RedT, RedInk, "arrow") { Text("Need us sooner? Slide for help any time, and we'll know right away.", fontWeight = FontWeight.SemiBold) }
                }
            }
            1 -> {
                Row(
                    Modifier.fillMaxWidth().background(if (fix == null && work.error != null) RedT else Ground, RoundedCornerShape(16.dp)).padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(64.dp).background(NavyT, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { GIcon("pin", Red, 30.dp) }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            when { fix == null -> "Finding your location…"; place != null -> place!!; else -> "%.4f, %.4f".format(fix.latitude, fix.longitude) },
                            fontWeight = FontWeight.Bold,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            GIcon("gps", Muted, 16.dp)
                            Text(
                                if (!granted) "Location is off. Turn it on for Guardian, then tap Next." else if (fix == null) "Stay on this screen a moment" else "±${fix.accuracy.toInt()} m",
                                color = Muted, fontSize = 13.sp,
                            )
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (activity == "other") GInput(activityText, { activityText = it }, "Kayaking, fishing, birding…", "other")
                    GInput(destination, { destination = it }, "Summit, peak or turnaround point", "flag")
                    GInput(route, { route = it }, "Way up, way down, where you'll stop", "route", lines = 3)
                }
            }
            2 -> {
                Seg(listOf(Triple("alone", "Just me", "user"), Triple("group", "With others", "users")), if (alone) "alone" else "group") { alone = it == "alone" }
                if (!alone) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        people.forEachIndexed { i, p ->
                            Column(Modifier.fillMaxWidth().background(Ground, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.size(40.dp).background(Navy, CircleShape), contentAlignment = Alignment.Center) { GIcon("user", Yellow, 20.dp) }
                                    GInput(p.name, { p.name = it }, "Their name", white = true, modifier = Modifier.weight(1f))
                                    Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable { people.removeAt(i) }, contentAlignment = Alignment.Center) {
                                        GIcon("x", Navy, 20.dp)
                                    }
                                }
                                PhoneInput(p.code, { p.code = it }, p.phone, { p.phone = it }, white = true)
                            }
                        }
                        DashedButton("Add a person") { people.add(Person()) }
                        Note("mobile", "Their numbers help us reach your group if we can't reach you.")
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (savedPets.isNotEmpty()) FlowRow(
                        Modifier.fillMaxWidth().background(Ground, RoundedCornerShape(14.dp)).padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        for (p in savedPets) GChip(p, p in pets, icon = "paw") { if (p in pets) pets.remove(p) else pets.add(p) }
                    }
                    newPets.forEachIndexed { i, name ->
                        Row(
                            Modifier.fillMaxWidth().background(Ground, RoundedCornerShape(14.dp)).padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(40.dp).background(Navy, CircleShape), contentAlignment = Alignment.Center) { GIcon("paw", Yellow, 20.dp) }
                            GInput(name, { newPets[i] = it }, "Pet's name", white = true, modifier = Modifier.weight(1f))
                            Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable { newPets.removeAt(i) }, contentAlignment = Alignment.Center) {
                                GIcon("x", Navy, 20.dp)
                            }
                        }
                    }
                    DashedButton("Add a pet") { newPets.add("") }
                }
            }
            3 -> {
                val left = back - System.currentTimeMillis()
                Column(Modifier.fillMaxWidth().background(Navy, RoundedCornerShape(20.dp)).padding(22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row {
                        Text("BACK BY", Modifier.weight(1f), color = Yellow, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = .12.em)
                        if (left > 0) Text("in ${shortDuration(left)}", color = Red, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    }
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(hhmm(back), color = Color.White, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 84.sp, lineHeight = 80.sp)
                        Text(dayWord(back).uppercase(), Modifier.padding(bottom = 8.dp), color = Color(0xFFC9CEE4), fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp)
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(top = 10.dp).heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = .12f))
                            .clickable { pickTime(context, back) { back = it; plusHours = 0 } }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(android.text.format.DateFormat.format("yyyy/MM/dd, HH:mm", back).toString(), Modifier.weight(1f), color = Color.White, fontWeight = FontWeight.SemiBold)
                        GIcon("calendar", Color.White, 18.dp)
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FieldLabel("Or from now")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (h in listOf(2, 4, 6, 8)) GChip("$h h", plusHours == h, Modifier.weight(1f)) {
                            back = roundUp(System.currentTimeMillis() + h * 3_600_000L); plusHours = h
                        }
                    }
                }
                Note("clock", "At this time we'll gently ask if you're okay. If we don't hear back within ${me.optInt("grace_minutes", 30)} minutes, our operators are alerted. Don't worry about being exact, you can always add more time.")
            }
            4 -> {
                Column {
                    for (item in items) CheckRow(item, item in ticked, low = item.startsWith("Phone battery") && battery < 50) {
                        if (it) ticked.add(item) else ticked.remove(item)
                    }
                }
                Note("battery", "Phone battery $battery%", if (battery < 50) Red else Muted)
            }
            5 -> {
                val (title, hint) = if (group) "Full-body group photo, today" to "Everyone head to toe, ${wear.second}. It shows us what each of you is wearing."
                else "Full-body photo, today" to "Head to toe, ${wear.first}. It shows us everything you're wearing."
                PhotoCard(photos["photo"], title, hint) { shoot("photo") }
                if (gear != null) Thumb(gear, activity, photos["gear_photo"]) { shoot("gear_photo") }
                Thumb("Sole of your shoe", "shoe", photos["shoe_photo"]) { shoot("shoe_photo") }
                Row(
                    Modifier.fillMaxWidth().background(Ground, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(44.dp).background(Navy, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        GIcon(ACTIVITY_ICON[activity] ?: "other", Yellow, 24.dp)
                    }
                    Column {
                        val what = if (activity == "other") activityText.ifBlank { activityName } else activityName
                        Text(listOfNotNull(what, place?.let { "from $it" }).joinToString(" "), fontWeight = FontWeight.Bold)
                        Text("Back by ${dayWord(back).lowercase()} ${hhmm(back)} · ${ticked.size} of ${items.size} ticked", color = Muted, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun HowItem(n: Int, title: String, body: String) = Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
    Num(n, Navy, Yellow)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        // **bold** in the copy, like the web's <strong>
        Text(buildAnnotatedString {
            body.split("**").forEachIndexed { i, part -> if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(part) } else append(part) }
        }, color = Muted, fontSize = 15.sp, lineHeight = 22.sp)
    }
}

// .photo-card: dashed card with a tall frame for the full-body photo.
@Composable
private fun PhotoCard(file: File?, title: String, hint: String, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().heightIn(min = 164.dp).dashed(16.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 14.dp),
    horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically,
) {
    Box(Modifier.size(80.dp, 128.dp).clip(RoundedCornerShape(10.dp)).background(Ground), contentAlignment = Alignment.Center) {
        if (file != null) LocalImage(file, Modifier.fillMaxSize()) else GIcon("body", Navy, 44.dp, stroke = 1.6f)
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(hint, color = Muted, fontSize = 14.sp, lineHeight = 20.sp)
        Row(
            Modifier.padding(top = 8.dp).heightIn(min = 36.dp).background(Navy, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            GIcon("camera", Color.White, 18.dp)
            Text(if (file != null) "Retake" else "Take photo", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// A labelled square for the shoe sole, or the wing or bike.
@Composable
private fun Thumb(label: String, icon: String, file: File?, onClick: () -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    FieldLabel(label)
    Box(
        Modifier.size(76.dp).clip(RoundedCornerShape(14.dp)).background(Color.White).border(2.dp, Navy, RoundedCornerShape(14.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { if (file != null) LocalImage(file, Modifier.fillMaxSize()) else GIcon(icon, Navy, 26.dp) }
}

@Composable
fun LocalImage(file: File, modifier: Modifier) {
    val bmp = remember(file, file.lastModified()) { BitmapFactory.decodeFile(file.path)?.asImageBitmap() }
    if (bmp != null) Image(bmp, null, modifier, contentScale = ContentScale.Crop)
}

// The camera, saving into the cache. Calls back with the key and the shrunk file.
@Composable
fun rememberCamera(done: (String, File) -> Unit): (String) -> Unit {
    val context = LocalContext.current
    var shooting by remember { mutableStateOf<Pair<String, File>?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val (key, file) = shooting ?: return@rememberLauncherForActivityResult
        if (ok && shrink(file)) done(key, file)
    }
    return { key ->
        val file = File(context.cacheDir, "photos/$key-${System.currentTimeMillis()}.jpg").apply { parentFile?.mkdirs() }
        shooting = key to file
        camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.files", file))
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
    val day = { t: Long -> Calendar.getInstance().apply { timeInMillis = t }.let { it.get(Calendar.YEAR) * 1000 + it.get(Calendar.DAY_OF_YEAR) } }
    val now = System.currentTimeMillis()
    return when (day(ms)) {
        day(now) -> "Today"
        day(now + 86_400_000) -> "Tomorrow"
        else -> android.text.format.DateFormat.format("EEE", ms).toString()
    }
}

// "3h 59m", as on the web's back-by card.
fun shortDuration(ms: Long): String {
    val m = ms / 60_000
    return listOf(m / 10080 to "w", m / 1440 % 7 to "d", m / 60 % 24 to "h", m % 60 to "m").filter { it.first > 0 }
        .joinToString(" ") { "${it.first}${it.second}" }.ifEmpty { "0m" }
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

// ---------- live trip ----------

@Composable
fun TripScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    var trip by remember { mutableStateOf(Store.trip) }
    var pending by remember { mutableStateOf(Store.helpPending) }
    var tick by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Store.me = Api.get("/api/me") } }
            trip = Store.trip
            pending = Store.helpPending
            tick = System.currentTimeMillis()
            if (trip == null) { TripService.stop(context); go(Screen.Home); return@LaunchedEffect }
            delay(if (trip?.optString("status") == "help" || pending != null) 5_000 else 15_000)
        }
    }
    val t = trip ?: return
    val id = t.getString("id")
    val status = t.optString("status")
    if (status == "help" || pending != null) return HelpScreen(t, status == "help", onUndo = { Store.helpPending = null; pending = null }, onCancelled = { trip = Store.trip })

    val backBy = t.optLong("return_by")
    fun extend(body: JSONObject) = work.run(scope, {
        val r = Api.post("/api/trips/$id/extend", body)
        Store.updateTrip { it.put("return_by", r.getLong("return_by")).put("status", "active") }
    }) { trip = Store.trip; tick = System.currentTimeMillis(); TripService.poke(context) }

    AppPage {
        ErrorBanner(work.error)
        if (status == "overdue") Column(Modifier.fillMaxWidth().background(Red, RoundedCornerShape(14.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("ARE YOU OKAY?", color = Color.White, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp, lineHeight = 30.sp)
            Text("You're past your return time. Let us know you're safe, or add more time. If we don't hear from you, we'll start checking on you.", color = Color.White, fontSize = 15.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GIcon(ACTIVITY_ICON[t.optString("activity")] ?: "other", Navy)
            Text(tripLine(t), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            Pill(status)
        }
        Column(
            Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(20.dp)).border(1.dp, Line, RoundedCornerShape(20.dp)).padding(horizontal = 20.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("BACK BY", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .1.em)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(hhmm(backBy), color = Navy, fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 88.sp, lineHeight = 84.sp)
                Text(dayWord(backBy).uppercase(), Modifier.padding(bottom = 8.dp), color = Muted, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp)
            }
            val left = backBy - tick
            Text(if (left > 0) "${duration(left)} left" else "Due ${duration(-left)} ago", fontWeight = FontWeight.SemiBold, color = if (left > 0) Ink else Red)
        }
        GButton("I'm back", icon = "check", big = true) { go(Screen.Back) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Label("Add more time")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in listOf(30, 60, 120, 240)) GChip(if (m < 60) "+$m min" else "+${m / 60} h", false, Modifier.weight(1f)) { extend(JSONObject().put("minutes", m)) }
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                LinkText("Pick a new time") { pickTime(context, backBy) { extend(JSONObject().put("return_by", it)) } }
            }
        }
        Box(Modifier.fillMaxWidth().heightIn(1.dp).background(Line))
        HelpSlider { Store.helpPending = id; pending = id; TripService.poke(context) }
        Note("pin", "While your trip is on we send your position every two minutes, even with the app closed. With no signal, positions wait on your phone and go when it's back.")
    }
}

fun activityLabel(t: JSONObject): String {
    val a = t.optString("activity")
    return if (a == "other") t.optString("activity_text").ifEmpty { "Trip" } else Store.me?.optJSONObject("activities")?.optString(a)?.ifEmpty { null } ?: a
}

// "Hike from Cape Town Ward 77", as the web's tripLine.
fun tripLine(t: JSONObject) = activityLabel(t) + (t.optString("start_place").takeIf { !t.isNull("start_place") && it.isNotEmpty() }?.let { " from $it" } ?: "")

// "I'm back" confirms first, on its own screen, so a pocket tap can't end the trip.
@Composable
fun BackScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val id = Store.trip?.optString("id") ?: return go(Screen.Home)
    BackHandler { go(Screen.Trip) }
    Page(Color.White, top = 56.dp) {
        DisplayText("Back safe?")
        Lead("This ends your trip, and SARZA stops watching the clock for you.")
        ErrorBanner(work.error)
        GButton(if (work.busy) "Ending…" else "Yes, I'm back", icon = "check", big = true, enabled = !work.busy) {
            work.run(scope, { Api.post("/api/trips/$id/back"); Store.me = Api.get("/api/me") }) {
                TripService.stop(context)
                go(Screen.Done(id))
            }
        }
        GButton("Not yet", Btn.Outline) { go(Screen.Trip) }
    }
}

// After "I'm back": the web's trip card, with its map, confetti and share button.
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DoneScreen(id: String, go: (Screen) -> Unit) {
    val leave = { go(Screen.HomeNotice("Welcome back. Your trip is closed.")) }
    var loading by remember { mutableStateOf(true) }
    BackHandler { leave() }
    Box(Modifier.fillMaxSize().background(Navy).navigationBarsPadding()) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
            WebView(c).apply {
                setBackgroundColor(Navy.toArgb())
                settings.javaScriptEnabled = true
                // WebView has no navigator.share, so app.js hands the card here.
                addJavascriptInterface(object {
                    @JavascriptInterface fun share(dataUrl: String, text: String) = shareCard(c, dataUrl, text)
                }, "GuardianApp")
                webViewClient = object : WebViewClient() {
                    // "Done" is the page's only link, and a trip that isn't closed redirects home.
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean { leave(); return true }
                    override fun onPageFinished(v: WebView, url: String) { loading = false }
                }
                loadUrl("${BuildConfig.API_URL}/trips/$id/done", mapOf("authorization" to "Bearer ${Store.token}"))
            }
        })
        // The server fetches the map tiles before it answers, which takes a few seconds.
        if (loading) Text("Drawing your route…", Modifier.align(Alignment.Center), color = Color.White)
    }
}

fun shareCard(c: Context, dataUrl: String, text: String) {
    val file = File(c.cacheDir, "photos/trip-card.png").apply { parentFile?.mkdirs(); writeBytes(Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)) }
    val send = Intent(Intent.ACTION_SEND).setType("image/png")
        .putExtra(Intent.EXTRA_STREAM, FileProvider.getUriForFile(c, "${c.packageName}.files", file))
        .putExtra(Intent.EXTRA_TEXT, text)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    c.startActivity(Intent.createChooser(send, null))
}

// The help screen: the three things someone who called for help needs to know, a way to cancel, and the chat.
@Composable
fun HelpScreen(t: JSONObject, alerted: Boolean, onUndo: () -> Unit, onCancelled: () -> Unit) {
    val context = LocalContext.current
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val id = t.getString("id")
    val backBy = t.optLong("return_by")
    val back = if (dayWord(backBy) == "Today") hhmm(backBy) else "${hhmm(backBy)} ${dayWord(backBy).lowercase()}"
    val sms = Store.me?.optString("sms_number")?.takeIf { it.isNotEmpty() && it != "null" }
    val emergency = Store.me?.optString("emergency_phone").orEmpty()
    val online = TripService.online(context)
    val queued = Store.queue().length()
    val last = Store.lastSent
    val stay = "If it's safe where you are, stay put."
    Surface(Modifier.fillMaxSize(), color = Ground) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Fact("bell", if (alerted) "SARZA has been alerted." else "Calling SARZA…",
                    if (alerted) "We'll contact you shortly." else if (!online) "We haven't reached SARZA yet. We'll keep trying, and send it the moment you have signal." else "",
                    alertedStyle = true)
                when {
                    !online || queued > 0 -> Fact("route", "No signal right now.", "We have your trip plan, and you're due back at $back. $stay If we still can't reach you by $back, we'll come and find you.")
                    last != null -> Fact("gps", "We know where you are.", "Last position ${hhmm(last.optLong("at"))}", fix = fixLine(last))
                    else -> Fact("gps", "Finding your location…", "")
                }
                if (online && queued == 0) Fact("flag", "Stay where you are.", if (last != null) "$stay We know where you are." else stay)
                if (!alerted && sms != null) GButton("Send SARZA a text", Btn.Outline) {
                    val where = last?.let { " Position %.5f, %.5f.".format(it.getDouble("lat"), it.getDouble("lng")) }.orEmpty()
                    context.open("sms:$sms?body=" + Uri.encode("HELP from ${Store.me?.optJSONObject("user")?.optString("name")}. ${tripLine(t)}.$where"))
                }
                if (!alerted && !online && emergency.isNotEmpty()) GButton("Phone SARZA ${formatPhone(emergency)}", Btn.Red, "phone") { context.call(emergency) }
                ErrorBanner(work.error)
                GButton("I'm fine, continue ${ACTIVITY_NOUN[t.optString("activity")] ?: "trip"}", Btn.Outline) {
                    if (alerted) work.run(scope, { Api.post("/api/trips/$id/cancel"); Store.me = Api.get("/api/me") }) { onCancelled() } else onUndo()
                }
            }
            if (alerted) Chat(id, "Message SARZA", mine = "explorer", modifier = Modifier.heightIn(min = 260.dp, max = 380.dp))
        }
    }
}

@Composable
private fun Fact(icon: String, title: String, sub: String, fix: String? = null, alertedStyle: Boolean = false) {
    val fg = if (alertedStyle) Color.White else Navy
    Row(
        Modifier.fillMaxWidth().background(if (alertedStyle) Alerted else Color.White, RoundedCornerShape(14.dp))
            .border(1.dp, if (alertedStyle) Alerted else Line, RoundedCornerShape(14.dp)).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        GIcon(icon, fg, modifier = Modifier.padding(top = 2.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = fg, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            if (sub.isNotEmpty()) Text(sub, color = if (alertedStyle) Color.White.copy(alpha = .82f) else Muted, fontSize = 15.sp)
            if (fix != null) Text(fix, Modifier.padding(top = 4.dp), color = Navy, fontFamily = Mono, fontSize = 14.sp)
        }
    }
}

// The position we hold, shown back as proof: "33.95750° S, 18.41050° E".
fun fixLine(p: JSONObject): String {
    fun deg(v: Double, pos: String, neg: String) = "%.5f° %s".format(abs(v), if (v < 0) neg else pos)
    val alt = if (p.isNull("altitude")) "" else "\nElevation ${p.optDouble("altitude").toInt()} m"
    return "${deg(p.getDouble("lat"), "N", "S")}, ${deg(p.getDouble("lng"), "E", "W")}$alt"
}

// Messages between the explorer and SARZA: a pale panel, bubbles, and a round composer at the bottom.
@Composable
fun Chat(tripId: String, placeholder: String, mine: String, modifier: Modifier = Modifier, card: Boolean = false) {
    var messages by remember { mutableStateOf(JSONArray()) }
    var text by remember { mutableStateOf("") }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    LaunchedEffect(tripId) {
        while (true) {
            withContext(Dispatchers.IO) { runCatching { Api.get("/api/trips/$tripId/messages").getJSONArray("messages") } }.onSuccess { messages = it }
            delay(5_000)
        }
    }
    val list = rememberScrollState()
    LaunchedEffect(messages.length()) { list.scrollTo(list.maxValue) }
    // On the help screen it's a pale panel that fills the bottom; on the operator's trip page, a white card that fits its thread.
    val shape = if (card) RoundedCornerShape(12.dp) else RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
    Column(
        modifier.fillMaxWidth().clip(shape).background(if (card) Color.White else NavyT)
            .then(if (card) Modifier.border(1.dp, Color(0xFFE4E4E7), shape) else Modifier).padding(start = 12.dp, end = 12.dp, top = 14.dp),
    ) {
        if (card) Text("Messages", color = Color(0xFF09090B), fontWeight = FontWeight.Bold, fontSize = 16.sp)
        else Text("Messages", Modifier.fillMaxWidth(), color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Column(
            Modifier.weight(1f, fill = !card).fillMaxWidth().verticalScroll(list).padding(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom),
        ) {
            for (i in 0 until messages.length()) {
                val m = messages.getJSONObject(i)
                val me = m.optString("author_role") == mine
                val media = m.optString("media_type").takeIf { !m.isNull("media_type") }
                val body = m.optString("body").ifEmpty { if (media?.startsWith("audio/") == true) "Voice note" else "Photo" }
                Column(
                    Modifier.align(if (me) Alignment.End else Alignment.Start).widthIn(max = 300.dp)
                        .background(if (me) Navy else Color.White, RoundedCornerShape(10.dp)).padding(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 5.dp),
                ) {
                    if (!me) Text(m.optString("author_name"), color = Navy, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(body, color = if (me) Color.White else Ink, fontSize = 15.sp)
                    Text(hhmm(m.optLong("created_at")), Modifier.align(Alignment.End), color = if (me) Color.White.copy(alpha = .7f) else Muted, fontSize = 11.sp)
                }
            }
        }
        if (work.error != null) Text(work.error!!, color = RedInk, fontSize = 13.sp)
        Row(Modifier.padding(top = 8.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            BasicTextField(
                text, { text = it }, Modifier.weight(1f), textStyle = TextStyle(fontFamily = Body, fontSize = 16.sp, color = Ink), cursorBrush = SolidColor(Navy),
                decorationBox = { inner ->
                    Box(Modifier.heightIn(min = 46.dp).background(if (card) Ground else Color.White, RoundedCornerShape(23.dp)).padding(horizontal = 16.dp, vertical = 11.dp)) {
                        if (text.isEmpty()) Text(placeholder, color = Color(0xFF8A8FA3), fontSize = 16.sp)
                        inner()
                    }
                },
            )
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(Navy).clickable(enabled = !work.busy && text.isNotBlank()) {
                    val sending = text
                    work.run(scope, { messages = Api.post("/api/trips/$tripId/messages", JSONObject().put("body", sending)).getJSONArray("messages") }) { text = "" }
                },
                contentAlignment = Alignment.Center,
            ) { GIcon("arrow", Color.White, 22.dp, stroke = 2.4f) }
        }
    }
}
