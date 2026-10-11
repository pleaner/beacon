package za.org.sarza.guardian

import android.Manifest
import android.app.DatePickerDialog
import android.content.Context
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale

// The server's lists, in constants.ts. Kept here so sign-up works before the app has talked to the server.
private val LANGUAGES = linkedMapOf("en" to "English", "de" to "German", "nl" to "Dutch", "fr" to "French", "es" to "Spanish",
    "it" to "Italian", "pt" to "Portuguese", "zh" to "Mandarin")
private val GENDERS = listOf("Female", "Male", "Non-binary")
private val RELATIONS = listOf("Partner or spouse", "Parent", "Child", "Brother or sister", "Other family", "Friend", "Colleague", "Other")
private val BLOOD_TYPES = listOf("O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-")

private val FIELDS = listOf("name", "phone", "email", "language", "birthday", "gender", "emergency_name", "emergency_relation",
    "emergency_phone", "height_cm", "weight_kg", "shoe_size", "blood_type", "allergies", "conditions", "medication",
    "medical_aid", "medical_aid_plan", "medical_aid_number")

// "+27825550147" back into "27" and "825550147" for the phone fields.
private fun splitPhone(p: String): Pair<String, String> {
    val code = COUNTRY_CODES.map { it.first }.sortedByDescending { it.length }.firstOrNull { p.startsWith("+$it") } ?: return "27" to p
    return code to p.removePrefix("+$code")
}

// Sign-up and profile editing, in the web app's five steps. Only the first step is required.
@Composable
fun ProfileScreen(go: (Screen) -> Unit) {
    val context = LocalContext.current
    val u = Store.me?.optJSONObject("user") ?: JSONObject()
    val v = remember {
        mutableStateMapOf<String, String>().apply {
            for (k in FIELDS) put(k, if (u.isNull(k)) "" else u.optString(k))
            // A new profile starts in the phone's language when it's one we offer.
            if (get("language").isNullOrEmpty()) put("language", Locale.getDefault().language.takeIf { it in LANGUAGES } ?: "en")
            // Stored as +27825550147; the form shows the code and the number apart.
            for (k in listOf("phone", "emergency_phone")) splitPhone(get(k).orEmpty()).let { (code, n) -> put("${k}_country", code); put(k, n) }
        }
    }
    var consent by remember { mutableStateOf(u.optInt("consent_contact", 0) == 1) }
    var photo by remember { mutableStateOf<File?>(null) }
    val shoot = rememberCamera { _, f -> photo = f }
    var step by remember { mutableIntStateOf(0) }
    var alertsOn by remember { mutableStateOf(notificationsOn(context)) }
    var locationOn by remember { mutableStateOf(locationOn(context)) }
    val askAlerts = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { alertsOn = it }
    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { locationOn = locationOn(context) }
    val work = rememberWork()
    val scope = rememberCoroutineScope()
    val exit = { go(if (Store.token == null) Screen.Welcome else Screen.Home) }
    BackHandler { if (step > 0) step-- else exit() }

    @Composable
    fun input(key: String, placeholder: String, icon: String? = null, type: KeyboardType = KeyboardType.Text, lines: Int = 1, unit: String? = null) =
        GInput(v[key].orEmpty(), { v[key] = it }, placeholder, icon, type, lines, unit)

    @Composable
    fun labelled(label: String, content: @Composable () -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { FieldLabel(label); content() }

    fun save() {
        val fields = (FIELDS + listOf("phone_country", "emergency_phone_country")).map { it to v[it].orEmpty() } +
            (if (consent) listOf("consent_contact" to "1") else emptyList())
        work.run(scope, {
            val r = Api.multipart("/api/profile", fields, listOfNotNull(photo?.let { "photo" to it }))
            if (Store.token == null) { Store.token = r.getString("token"); Store.role = "explorer" }
            Store.me = Api.get("/api/me")
        }) {
            Guardian.registerForPush(context)
            go(if (u.length() == 0) Screen.HomeNotice("Profile saved. Allow notifications so the alarm can reach you.") else Screen.HomeNotice("Profile saved."))
        }.invokeOnCompletion {
            // The server turned down something from the first step, like the email address: show it there.
            if (work.error?.contains("email", ignoreCase = true) == true || work.error?.contains("required") == true) step = 0
        }
    }

    val titles = listOf("Who are you?", "Who should we call?", "Help searchers find you", "Anything medical?", "Make sure we can reach you")
    val leads = listOf(
        "Tell us once. After that, each trip takes a minute to file.",
        "If you're overdue or call for help, our operators can phone this person.",
        "A clear photo and a few numbers help searchers recognise you.",
        "Only SARZA operators see this, to help rescuers look after you.",
        "Guardian needs these to work. Without them, we can't tell you when you're overdue or find you when you need help.",
    )
    FlowPage(
        step, 5, titles[step], leads[step], onBack = { if (step > 0) step-- else exit() },
        actions = {
            if (step < 4) {
                GButton("", icon = "arrow") {
                    work.error = if (step == 0 && (v["name"].isNullOrBlank() || v["phone"].isNullOrBlank() || v["email"].isNullOrBlank()))
                        "Name, phone and email are required" else null
                    if (work.error == null) step++
                }
                if (step > 0) GButton("Skip for now", Btn.Ghost) { step++ }
            } else GButton(if (work.busy) "Saving…" else if (Store.token == null) "Finish" else "Save", icon = "check", enabled = !work.busy) { save() }
        },
    ) {
        ErrorBanner(work.error)
        when (step) {
            0 -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                GSelect(v["language"], "Language", LANGUAGES.toList(), { v["language"] = it }, "globe")
                input("name", "Your full name", "user")
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).background(Ground)
                        .clickable { pickDate(context, v["birthday"].orEmpty()) { v["birthday"] = it } }.padding(horizontal = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    GIcon("cake", Navy)
                    Text(v["birthday"].orEmpty().ifEmpty { "Birthday" }, Modifier.weight(1f), color = if (v["birthday"].isNullOrEmpty()) Color(0xFF8A8FA3) else Ink, fontSize = 17.sp)
                    GIcon("calendar", Ink, 18.dp)
                }
                GSelect(v["gender"], "Gender", GENDERS.map { it to it }, { v["gender"] = it }, "userCircle")
                PhoneInput(v["phone_country"].orEmpty(), { v["phone_country"] = it }, v["phone"].orEmpty(), { v["phone"] = it })
                input("email", "you@example.com", "mail", KeyboardType.Email)
            }
            1 -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                labelled("Their name") { input("emergency_name", "e.g. Lindiwe Mokoena") }
                labelled("How you know them") { GSelect(v["emergency_relation"], "Choose one", RELATIONS.map { it to it }, { v["emergency_relation"] = it }) }
                labelled("Their number") { PhoneInput(v["emergency_phone_country"].orEmpty(), { v["emergency_phone_country"] = it }, v["emergency_phone"].orEmpty(), { v["emergency_phone"] = it }) }
            }
            2 -> {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(148.dp).dashed(74.dp, bg = Ground).clip(CircleShape).clickable { shoot("photo") }, contentAlignment = Alignment.Center) {
                        val f = photo
                        val key = u.optString("photo_key").takeIf { !u.isNull("photo_key") && it.isNotEmpty() }
                        when {
                            f != null -> LocalImage(f, Modifier.fillMaxSize())
                            key != null -> AuthImage("/photos/$key", Modifier.fillMaxSize())
                            else -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                GIcon("camera", Navy, 30.dp)
                                Text("Add photo", color = Navy, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    Lead("A clear photo of your face")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) { labelled("Height") { input("height_cm", "175", type = KeyboardType.Number, unit = "cm") } }
                    Column(Modifier.weight(1f)) { labelled("Weight") { input("weight_kg", "70", type = KeyboardType.Number, unit = "kg") } }
                    Column(Modifier.weight(1f)) { labelled("Shoe size") { input("shoe_size", "8", type = KeyboardType.Decimal, unit = "UK") } }
                }
            }
            3 -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                labelled("Blood type") { GSelect(v["blood_type"].orEmpty(), "Don't know", listOf("" to "Don't know") + BLOOD_TYPES.map { it to it }, { v["blood_type"] = it }) }
                labelled("Allergies") { input("allergies", "e.g. bee stings, penicillin", lines = 3) }
                labelled("Conditions") { input("conditions", "e.g. asthma, diabetes, epilepsy", lines = 3) }
                labelled("Medication") { input("medication", "What you take, and what you carry", lines = 3) }
                labelled("Medical aid") { input("medical_aid", "e.g. Discovery Health") }
                labelled("Plan or option") { input("medical_aid_plan", "e.g. Classic Saver") }
                labelled("Membership number") { input("medical_aid_number", "With your dependant code, if you have one") }
            }
            4 -> {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Setup(1, "Allow notifications", "So we can gently ask if you're okay when you're late back.", alertsOn, "Allow notifications") {
                        if (Build.VERSION.SDK_INT >= 33) askAlerts.launch(Manifest.permission.POST_NOTIFICATIONS) else context.openAppSettings()
                    }
                    Setup(2, "Allow your location", "So we can send your position while you're out, and find you if you call for help.", locationOn, "Allow location") {
                        askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                }
                CheckRow("SARZA may contact me about the service, fundraising, and events", consent) { consent = it }
            }
        }
    }
}

fun locationOn(c: Context) = androidx.core.content.ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) ==
    android.content.pm.PackageManager.PERMISSION_GRANTED

// .setup: numbered row, yellow until done, navy after.
@Composable
private fun Setup(n: Int, title: String, body: String, done: Boolean, button: String, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().background(Ground, RoundedCornerShape(16.dp)).padding(18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp),
) {
    Num(n, if (done) Navy else Yellow, if (done) Color.White else Ink)
    Column(Modifier.weight(1f)) {
        Text(title, fontWeight = FontWeight.Bold)
        Text(body, Modifier.padding(top = 4.dp, bottom = 8.dp), color = Muted, fontSize = 15.sp)
        if (!done) GButton(button, Btn.Outline, small = true, modifier = Modifier) { onClick() }
    }
}

fun pickDate(c: Context, current: String, set: (String) -> Unit) {
    val cal = Calendar.getInstance()
    val (y, m, d) = current.split("-").mapNotNull { it.toIntOrNull() }.takeIf { it.size == 3 } ?: listOf(cal.get(Calendar.YEAR) - 30, 1, 1)
    DatePickerDialog(c, { _, yy, mm, dd -> set("%04d-%02d-%02d".format(yy, mm + 1, dd)) }, y, m - 1, d)
        .apply { datePicker.maxDate = System.currentTimeMillis() }.show()
}
