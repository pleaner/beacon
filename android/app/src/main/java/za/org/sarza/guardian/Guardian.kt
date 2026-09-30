package za.org.sarza.guardian

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

class Guardian : Application() {
    override fun onCreate() {
        super.onCreate()
        Store.init(this)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_TRIP, "Trip in progress", NotificationManager.IMPORTANCE_LOW),
            // The app plays its own siren on the alarm stream, so this channel stays silent.
            NotificationChannel(CH_ALARM, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) },
            NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH),
        ))
        if (BuildConfig.FIREBASE_APP_ID.isNotEmpty() && FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(this, FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .build())
        }
    }

    companion object {
        const val CH_TRIP = "trip"
        const val CH_ALARM = "alarm"
        const val CH_MESSAGES = "messages"

        // Network work that must not run on the main thread and need not report back.
        val io = Executors.newSingleThreadExecutor()

        // Tell the server which phone to push to. Quietly does nothing without Firebase or a signed-in user.
        fun registerForPush(context: Context) {
            if (FirebaseApp.getApps(context).isEmpty() || Store.token == null) return
            FirebaseMessaging.getInstance().token.addOnSuccessListener { t ->
                io.execute { runCatching { Api.post("/api/push/device", JSONObject().put("token", t)) } }
            }
        }
    }
}

// Everything the app keeps on the phone. The cached /api/me answer lets the trip screen work without signal.
object Store {
    private lateinit var p: SharedPreferences
    fun init(c: Context) { p = c.getSharedPreferences("guardian", Context.MODE_PRIVATE) }

    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit().putString("token", v).apply()
    var role: String?
        get() = p.getString("role", null)
        set(v) = p.edit().putString("role", v).apply()
    var me: JSONObject?
        get() = p.getString("me", null)?.let { JSONObject(it) }
        set(v) = p.edit().putString("me", v?.toString()).apply()
    // The trip whose call for help hasn't reached the server yet.
    var helpPending: String?
        get() = p.getString("help", null)
        set(v) = p.edit().putString("help", v).apply()
    // The last siren request this phone already played.
    var sirenHeard: Long
        get() = p.getLong("siren", 0)
        set(v) = p.edit().putLong("siren", v).apply()
    // The return time this phone already rang "Are you okay?" for.
    var alarmedFor: Long
        get() = p.getLong("alarmed", 0)
        set(v) = p.edit().putLong("alarmed", v).apply()

    val trip: JSONObject? get() = me?.optJSONObject("trip")

    fun updateTrip(change: (JSONObject) -> Unit) {
        val m = me ?: return
        val t = m.optJSONObject("trip") ?: return
        change(t)
        me = m
    }

    fun signOut() = p.edit().clear().apply()

    // Fixes waiting for signal. ponytail: keeps the newest 500, about 16 h at one fix every 2 minutes, like the web app.
    @Synchronized fun queue(): JSONArray = JSONArray(p.getString("queue", "[]"))
    @Synchronized fun enqueue(fix: JSONObject) {
        val q = queue().put(fix)
        val keep = JSONArray()
        for (i in maxOf(0, q.length() - 500) until q.length()) keep.put(q.get(i))
        p.edit().putString("queue", keep.toString()).apply()
    }
    @Synchronized fun dropFromQueue(n: Int) {
        val q = queue()
        val keep = JSONArray()
        for (i in n until q.length()) keep.put(q.get(i))
        p.edit().putString("queue", keep.toString()).apply()
    }
    @Synchronized fun clearQueue() = p.edit().putString("queue", "[]").apply()
}
