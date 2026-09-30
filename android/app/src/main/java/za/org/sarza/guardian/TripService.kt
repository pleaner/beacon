package za.org.sarza.guardian

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Runs for the whole trip, with its notification in the status bar. Takes a fix every 2 minutes (30 seconds after a
// call for help), queues them on the phone, and sends them when there is signal. The reply to each upload says
// whether an operator wants the siren. Also keeps retrying an unsent call for help, and rings "Are you okay?" at the
// return time even with no signal at all.
class TripService : Service(), LocationListener {
    private val handler = Handler(Looper.getMainLooper())
    private var every = 0L
    private val tick = object : Runnable {
        override fun run() {
            Guardian.io.execute { sync() }
            checkOverdue()
            refresh()
            handler.postDelayed(this, 60_000)
        }
    }

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Store.trip == null) { stopSelf(); return START_NOT_STICKY }
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            else startForeground(ID, notification())
        } catch (e: Exception) {
            // Android won't let a location service start from the background (after a restart, say). Opening the app does it.
            stopSelf()
            return START_NOT_STICKY
        }
        listen()
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        getSystemService(LocationManager::class.java).removeUpdates(this)
        super.onDestroy()
    }

    @SuppressLint("MissingPermission")
    private fun listen() {
        val want = if (Store.trip?.optString("status") == "help" || Store.helpPending != null) 30_000L else 120_000L
        if (want == every) return
        every = want
        val lm = getSystemService(LocationManager::class.java)
        lm.removeUpdates(this)
        runCatching { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, every, 0f, this, Looper.getMainLooper()) }
    }

    override fun onLocationChanged(loc: Location) {
        Store.enqueue(JSONObject()
            .put("lat", loc.latitude).put("lng", loc.longitude).put("at", loc.time)
            .put("accuracy", if (loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
            .put("altitude", if (loc.hasAltitude()) loc.altitude else JSONObject.NULL)
            .put("altitude_accuracy", if (loc.hasVerticalAccuracy()) loc.verticalAccuracyMeters.toDouble() else JSONObject.NULL)
            .put("battery", battery(this))
            .put("signal", if (online(this)) "online" else "none"))
        Guardian.io.execute { sync() }
    }

    // On the io thread. Help first, then the queued fixes.
    private fun sync() {
        val id = Store.trip?.optString("id") ?: return
        if (Store.helpPending == id) {
            try {
                Api.post("/api/trips/$id/help")
                Store.helpPending = null
                refreshMe()
            } catch (e: Api.Failed) {
                // The trip ended, or help was already on: retrying won't change that.
                Store.helpPending = null
                refreshMe()
            } catch (_: Exception) {
            }
        }
        while (true) {
            val q = Store.queue()
            if (q.length() == 0) break
            val batch = JSONArray()
            for (i in 0 until minOf(50, q.length())) batch.put(q.get(i))
            val reply = try {
                Api.post("/api/trips/$id/positions", batch)
            } catch (e: Api.Failed) {
                if (e.status == 409 || e.status == 404) { Store.clearQueue(); refreshMe() }
                break
            } catch (_: Exception) {
                break
            }
            Store.dropFromQueue(batch.length())
            Store.updateTrip { t ->
                t.put("status", reply.optString("status", t.optString("status")))
                t.put("return_by", reply.optLong("return_by", t.optLong("return_by")))
            }
            val siren = reply.optLong("siren_at", 0)
            if (siren > Store.sirenHeard) {
                Store.sirenHeard = siren
                handler.post { Alarm.ring(this, "SARZA is looking for you", "Your phone is sounding so searchers can hear it. Tap Stop once they've found you.") }
            }
        }
        handler.post { listen(); refresh() }
    }

    private fun refreshMe() {
        runCatching { Store.me = Api.get("/api/me") }
        if (Store.trip == null) handler.post { stopSelf() }
    }

    private fun checkOverdue() {
        val t = Store.trip ?: return
        val back = t.optLong("return_by")
        if (t.optString("status") == "help" || System.currentTimeMillis() < back || Store.alarmedFor == back) return
        Store.alarmedFor = back
        Alarm.ring(this, "Are you okay?", "You're past your return time. Open Guardian to say you're safe, or add more time.")
    }

    private fun refresh() = getSystemService(NotificationManager::class.java).notify(ID, notification())

    private fun notification(): Notification {
        val t = Store.trip
        val back = t?.optLong("return_by") ?: 0
        val left = back - System.currentTimeMillis()
        val text = when {
            t?.optString("status") == "help" -> "SARZA has been alerted."
            Store.helpPending != null -> "Sending your call for help…"
            left < 0 -> "Overdue. Back by ${hhmm(back)}."
            else -> "Back by ${hhmm(back)}, ${duration(left)} left."
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val extend = PendingIntent.getBroadcast(this, 0, Intent(this, TripAction::class.java).setAction(TripAction.EXTEND), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, Guardian.CH_TRIP)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Guardian: trip in progress")
            .setContentText(text)
            .setOngoing(true)
            .setGroup("trip")
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Add 1 hour", extend).build())
            .addAction(Notification.Action.Builder(null, "Open", open).build())
            .build()
    }

    companion object {
        const val ID = 1

        fun start(c: Context) = c.startForegroundService(Intent(c, TripService::class.java))
        fun stop(c: Context) = c.stopService(Intent(c, TripService::class.java))
        fun poke(c: Context) = runCatching { c.startService(Intent(c, TripService::class.java)) }

        fun battery(c: Context) = c.getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        fun online(c: Context): Boolean {
            val cm = c.getSystemService(ConnectivityManager::class.java)
            return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        }
    }
}

fun hhmm(ms: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
fun duration(ms: Long): String {
    val m = ms / 60_000
    return if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"
}

// "Add 1 hour" on the trip notification.
class TripAction : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
        val id = Store.trip?.optString("id") ?: return
        val done = goAsync()
        Guardian.io.execute {
            try {
                val r = Api.post("/api/trips/$id/extend", JSONObject().put("minutes", 60))
                Store.updateTrip { it.put("return_by", r.getLong("return_by")).put("status", "active") }
                Alarm.stop(c)
            } catch (_: Exception) {
                android.os.Handler(Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(c, "Couldn't add time. Check your signal, or open Guardian.", android.widget.Toast.LENGTH_LONG).show()
                }
            }
            TripService.poke(c)
            done.finish()
        }
    }

    companion object { const val EXTEND = "extend" }
}
