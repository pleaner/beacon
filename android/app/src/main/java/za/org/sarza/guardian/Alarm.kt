package za.org.sarza.guardian

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

// Rings loudly: the siren, "Are you okay?" and operator alerts. Plays on the alarm stream at full volume, which
// silent mode doesn't mute and Do Not Disturb lets through by default. Stops on "Stop", on opening the app, or after
// three minutes.
object Alarm {
    const val NOTIFICATION_ID = 2
    private const val RATE = 22_050
    private var track: AudioTrack? = null
    private var restoreVolume = -1
    private val handler = Handler(Looper.getMainLooper())

    // From the trip service, which already keeps the app alive. Pushes go through AlarmService instead.
    fun ring(c: Context, title: String, body: String, url: String? = null) {
        c.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(c, title, body, url))
        sound(c)
    }

    fun ringFromPush(c: Context, title: String, body: String, url: String? = null) {
        c.startForegroundService(Intent(c, AlarmService::class.java).putExtra("title", title).putExtra("body", body).putExtra("url", url))
    }

    fun stop(c: Context) {
        silence(c)
        c.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        c.stopService(Intent(c, AlarmService::class.java))
    }

    fun notification(c: Context, title: String, body: String, url: String?): Notification {
        val open = PendingIntent.getActivity(c, 0,
            Intent(c, MainActivity::class.java).putExtra("url", url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getBroadcast(c, 0, Intent(c, StopAlarm::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(c, Guardian.CH_ALARM)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_ALARM)
            .setGroup("alarm")
            .setContentIntent(open)
            .setDeleteIntent(stop)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }

    @Synchronized fun sound(c: Context) {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ stop(c) }, 170_000)
        if (track != null) return
        val am = c.getSystemService(AudioManager::class.java)
        restoreVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        // Fails under "total silence" Do Not Disturb; it rings at whatever the alarm volume is then.
        runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
        val samples = siren()
        track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .setAudioFormat(AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(samples.size * 2)
            .build().apply {
                write(samples, 0, samples.size)
                setLoopPoints(0, samples.size, -1)
                play()
            }
        c.getSystemService(Vibrator::class.java).vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0))
    }

    @Synchronized private fun silence(c: Context) {
        handler.removeCallbacksAndMessages(null)
        val t = track ?: return
        track = null
        t.stop()
        t.release()
        c.getSystemService(Vibrator::class.java).cancel()
        if (restoreVolume >= 0) runCatching {
            c.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, restoreVolume, 0)
        }
    }

    // One second up from 650 Hz to 1600 Hz and one second back down: a wail that carries and doesn't sound like a ringtone.
    private fun siren(): ShortArray {
        var phase = 0.0
        return ShortArray(RATE * 2) { i ->
            val t = i.toDouble() / RATE
            phase += 2 * PI * (650 + 950 * (1 - abs(t - 1))) / RATE
            (sin(phase) * Short.MAX_VALUE * 0.9).toInt().toShort()
        }
    }
}

// Keeps the app alive while a push rings when nothing else is running.
class AlarmService : Service() {
    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = Alarm.notification(this, intent?.getStringExtra("title") ?: "Guardian", intent?.getStringExtra("body") ?: "", intent?.getStringExtra("url"))
        if (Build.VERSION.SDK_INT >= 34) startForeground(Alarm.NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        else startForeground(Alarm.NOTIFICATION_ID, n)
        Alarm.sound(this)
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int) = Alarm.stop(this)
}

class StopAlarm : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) = Alarm.stop(c)
}
