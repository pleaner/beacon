package za.org.sarza.guardian

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

// Pushes from the server. They are data-only, so this runs even when the app is closed and picks how loud to be.
class Push : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (Store.token == null) return
        runCatching { Api.post("/api/push/device", JSONObject().put("token", token)) }
    }

    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        val title = d["title"] ?: "Guardian"
        val body = d["body"] ?: ""
        val url = d["url"]
        when (d["kind"]) {
            "siren" -> {
                Store.sirenHeard = System.currentTimeMillis()
                Alarm.ringFromPush(this, title, "$body Tap Stop once they've found you.", url)
            }
            "prompt" -> {
                // The trip service may have rung for this return time already, with or without signal.
                val back = Store.trip?.optLong("return_by") ?: 0
                if (back != 0L && Store.alarmedFor == back) return
                Store.alarmedFor = back
                Alarm.ringFromPush(this, title, body, url)
            }
            "help", "overdue" -> Alarm.ringFromPush(this, title, body, url)
            else -> {
                val open = PendingIntent.getActivity(this, url.hashCode(),
                    Intent(this, MainActivity::class.java).putExtra("url", url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                getSystemService(NotificationManager::class.java).notify(d["tag"] ?: "guardian", 0,
                    Notification.Builder(this, Guardian.CH_MESSAGES)
                        .setSmallIcon(R.drawable.ic_stat)
                        .setContentTitle(title)
                        .setContentText(body)
                        .setContentIntent(open)
                        .setAutoCancel(true)
                        .build())
            }
        }
    }
}
