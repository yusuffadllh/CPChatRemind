package com.yusuf.wareminder.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class GeminiClient(
    private val apiKey: String,
    private val model: String = "gemini-2.0-flash",
    private val client: OkHttpClient = defaultClient
) {

    /**
     * Kirim isi pesan WA ke Gemini dan minta JSON terstruktur.
     * @throws IOException kalau jaringan/HTTP gagal (biar Worker bisa retry).
     */
    suspend fun extract(
        message: String,
        sender: String,
        timezone: String
    ): ExtractionResult = withContext(Dispatchers.IO) {
        val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
        val now = ZonedDateTime.now(zone)
        val body = buildRequestBody(message, sender, now, zone)

        val request = Request.Builder()
            .url("$ENDPOINT/$model:generateContent")
            .header("x-goog-api-key", apiKey)
            .header("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON_MEDIA))
            .build()

        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException("Gemini HTTP ${response.code}: ${raw.take(300)}")
            }
            parseResponse(raw)
        }
    }

    private fun buildRequestBody(
        message: String,
        sender: String,
        now: ZonedDateTime,
        zone: ZoneId
    ): JsonObject = buildJsonObject {
        putJsonArray("contents") {
            add(buildJsonObject {
                put("role", "user")
                putJsonArray("parts") {
                    add(buildJsonObject {
                        put("text", userPrompt(message, sender, now, zone))
                    })
                }
            })
        }
        putJsonObject("systemInstruction") {
            putJsonArray("parts") {
                add(buildJsonObject { put("text", SYSTEM_PROMPT) })
            }
        }
        putJsonObject("generationConfig") {
            put("temperature", 0.1)
            put("responseMimeType", "application/json")
            put("responseSchema", RESPONSE_SCHEMA)
        }
    }

    private fun userPrompt(
        message: String,
        sender: String,
        now: ZonedDateTime,
        zone: ZoneId
    ): String = buildString {
        appendLine("Waktu sekarang: ${now.format(HUMAN_FORMAT)} (${zone.id})")
        appendLine("Hari ini: ${now.format(DateTimeFormatter.ISO_LOCAL_DATE)}")
        appendLine("Pengirim: $sender")
        appendLine()
        appendLine("Isi pesan WhatsApp:")
        appendLine("\"\"\"")
        appendLine(message)
        append("\"\"\"")
    }

    private fun parseResponse(raw: String): ExtractionResult {
        val root = json.parseToJsonElement(raw).jsonObject
        val text = root["candidates"]?.jsonArray
            ?.firstOrNull()?.jsonObject
            ?.get("content")?.jsonObject
            ?.get("parts")?.jsonArray
            ?.mapNotNull { it.jsonObject["text"]?.jsonPrimitive?.content }
            ?.joinToString("")
            ?.trim()

        if (text.isNullOrBlank()) {
            val reason = root["promptFeedback"]?.toString() ?: raw.take(200)
            throw IOException("Gemini tidak mengembalikan teks: $reason")
        }

        return json.decodeFromString(ExtractionResult.serializer(), text.stripCodeFence())
    }

    private fun String.stripCodeFence(): String {
        if (!startsWith("```")) return this
        return substringAfter('\n').substringBeforeLast("```").trim()
    }

    companion object {
        private const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private val HUMAN_FORMAT = DateTimeFormatter.ofPattern("EEEE, dd MMMM yyyy HH:mm")

        private val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            coerceInputValues = true
        }

        private val defaultClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()
        }

        private val SYSTEM_PROMPT = """
            Kamu adalah asisten yang membaca pesan WhatsApp berbahasa Indonesia (bisa campur
            bahasa Inggris atau bahasa gaul) dan mengubahnya menjadi data terstruktur.

            Tentukan salah satu:
            - "event": pesan berisi acara/janji/deadline/pengingat yang punya waktu jelas atau bisa
              disimpulkan (contoh: "besok jam 3 meeting", "Senin depan bayar listrik").
            - "note": pesan berisi informasi yang perlu dicatat tapi TIDAK punya waktu
              (contoh: "wifi password rumah 12345", "beli beras dan minyak").
            - "ignore": obrolan biasa, sapaan, spam, OTP, atau pesan tanpa informasi berguna.

            Aturan:
            1. Buang prefix perintah seperti "/catat" atau "/ingatkan" dari judul.
            2. "title" singkat, maksimal 60 karakter, tanpa tanda kutip, Bahasa Indonesia.
            3. Untuk "event": "datetime_start" WAJIB terisi. Format ISO-8601 waktu lokal
               tanpa offset, contoh 2026-08-26T15:00:00. Resolusi kata relatif ("besok",
               "nanti sore", "Senin depan") berdasarkan waktu sekarang yang diberikan.
            4. Kalau jam tidak disebut, pakai 09:00. Kalau hanya "pagi" pakai 08:00,
               "siang" 12:00, "sore" 16:00, "malam" 19:00.
            5. "datetime_end" opsional; kalau durasi tidak jelas biarkan null.
            6. "all_day" true hanya kalau jelas acara sepanjang hari.
            7. "note" berisi detail lengkap/isi catatan. Untuk type "note" wajib terisi.
            8. "confidence" 0.0-1.0 sesuai keyakinanmu.
            9. Balas HANYA JSON sesuai skema, tanpa penjelasan tambahan.
        """.trimIndent()

        private val RESPONSE_SCHEMA = buildJsonObject {
            put("type", "OBJECT")
            putJsonObject("properties") {
                putJsonObject("type") {
                    put("type", "STRING")
                    putJsonArray("enum") {
                        add(JsonPrimitive("event"))
                        add(JsonPrimitive("note"))
                        add(JsonPrimitive("ignore"))
                    }
                }
                putJsonObject("title") { put("type", "STRING") }
                putJsonObject("datetime_start") { put("type", "STRING"); put("nullable", true) }
                putJsonObject("datetime_end") { put("type", "STRING"); put("nullable", true) }
                putJsonObject("all_day") { put("type", "BOOLEAN") }
                putJsonObject("location") { put("type", "STRING"); put("nullable", true) }
                putJsonObject("note") { put("type", "STRING"); put("nullable", true) }
                putJsonObject("confidence") { put("type", "NUMBER") }
            }
            put("required", buildJsonArray {
                add(JsonPrimitive("type"))
                add(JsonPrimitive("title"))
                add(JsonPrimitive("confidence"))
            })
        }
    }
}
