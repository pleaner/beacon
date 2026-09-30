package za.org.sarza.guardian

import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

// The Guardian server's JSON API. Blocking: call it off the main thread.
object Api {
    class Failed(val status: Int, message: String) : Exception(message)

    fun get(path: String) = send("GET", path, null, null)
    fun post(path: String, body: Any = JSONObject()) = send("POST", path, "application/json", body.toString().toByteArray())

    // A form with files, for the trip plan and its photos. Repeated keys go in as repeated fields.
    fun multipart(path: String, fields: List<Pair<String, String>>, files: List<Pair<String, File>>): JSONObject {
        val b = "----guardian" + UUID.randomUUID()
        val out = java.io.ByteArrayOutputStream()
        fun w(s: String) = out.write(s.toByteArray())
        for ((k, v) in fields) w("--$b\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n")
        for ((k, f) in files) {
            w("--$b\r\nContent-Disposition: form-data; name=\"$k\"; filename=\"${f.name}\"\r\nContent-Type: image/jpeg\r\n\r\n")
            out.write(f.readBytes())
            w("\r\n")
        }
        w("--$b--\r\n")
        return send("POST", path, "multipart/form-data; boundary=$b", out.toByteArray())
    }

    private fun send(method: String, path: String, type: String?, body: ByteArray?): JSONObject {
        val c = URL(BuildConfig.API_URL + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.instanceFollowRedirects = false
            c.setRequestProperty("accept", "application/json")
            Store.token?.let { c.setRequestProperty("authorization", "Bearer $it") }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("content-type", type)
                c.outputStream.use { it.write(body) }
            }
            val status = c.responseCode
            val text = (if (status < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
            if (status !in 200..299) throw Failed(status, json.optString("error").ifEmpty { "Something went wrong ($status)" })
            return json
        } finally {
            c.disconnect()
        }
    }
}
