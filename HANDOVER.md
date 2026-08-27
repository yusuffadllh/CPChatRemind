# HANDOVER — WA Reminder

> Dokumen ini dibuat supaya konteks tidak hilang kalau chat ke-reset saat open folder.
> Kalau kamu (AI/asisten baru) membaca ini: baca seluruh file dulu sebelum menulis kode.

Terakhir diperbarui: 2026-08-25
Lokasi project: `E:\Project\wa-reminder`

---

## 1. Apa yang diminta user

User ingin sistem yang membaca pesan WhatsApp miliknya sendiri, lalu otomatis:

- dicatat sebagai **catatan**, atau
- dibuatkan **reminder / event di aplikasi Kalender BAWAAN Android**.

Kutipan asli user:

> "bukan baca notifikasi, tpi kek saya wa ke wa lain (wa ke nomor saya sendiri)
> dan dia baca itu lalu di catet or bikin reminder di apk bawaaan"

> "bukan google calender, tpi KALENDER BAWAAN HP"

> "ini ibarat kek bikin bot wa sebenernya buat pribadi"

**PENTING — jangan tawarkan Google Calendar lagi.** User sudah menolak secara eksplisit.

---

## 2. Arsitektur final: Opsi B — server Baileys + CalDAV

User ternyata punya server sendiri, dan menerima risiko Baileys:

> "gpp pake baileys, soalnya bkn ngeblast tpi lebih dipake buat pencatatan noted dan lainnya"

```
Pesan WA (termasuk "Pesan ke Diri Sendiri")
        ↓
Baileys — sesi perangkat tertaut (linked device)
        ↓  react ⏳
Filter: whitelist nomor / self-chat / prefix kata kunci (opsional)
        ↓
Gemini → JSON terstruktur { type, title, datetime_start, ... }
        ↓
   ┌──────────────────────┬────────────────────┐
   │ type = event         │ type = note        │
   ↓                      ↓
CalDAV (Radicale)     data/notes.jsonl
+ VALARM reminder
        ↓  react 📅 / 📝 / 🤷 / ❌ + balasan ringkas
        ↓
HP: DAVx5 sync Radicale → event muncul di Kalender bawaan Android
```

### Kenapa Opsi B

- Satu komponen saja yang dirawat (server), tanpa APK.
- **"Pesan ke Diri Sendiri" jalan.** Ini tidak mungkin lewat notifikasi, karena chat ke diri
  sendiri tidak memunculkan notifikasi — dulu itulah alasan butuh nomor kedua.
- **React emoji jalan.** Satu baris di Baileys:
  `sock.sendMessage(jid, { react: { text: '✅', key: msg.key } })`
- Trade-off: DAVx5 sync lewat polling, default 15 menit (bisa dipercepat di setelan akun).

### Koreksi terhadap catatan sesi lama

Klaim "react emoji tidak bisa" **hanya berlaku untuk jalur `NotificationListenerService`** —
notifikasi WhatsApp cuma mengekspos action *Reply* dan *Mark as read*. Lewat Baileys, react
sepenuhnya bisa.

Selain itu: `CalendarContract` adalah content provider lokal, jadi **hanya bisa ditulis dari
proses di dalam HP**. Bot di server tidak akan pernah bisa menulis langsung ke kalender
bawaan. CalDAV + DAVx5 adalah jembatannya tanpa perlu APK.

---

## 3. Kode server — SELESAI & lolos typecheck

Lokasi: `E:\Project\wa-reminder\server\`. Panduan pemakaian lengkap ada di
[server/README.md](server/README.md).

| File | Isi |
|---|---|
| `src/index.ts` | entrypoint: log config, `verifyConnection()` CalDAV, start Baileys, handle SIGINT/SIGTERM |
| `src/whatsapp.ts` | Baileys: multi-file auth, QR di terminal, reconnect (delay 3s, berhenti kalau `loggedOut`), skip grup/status/newsletter, deteksi self-chat, `getSocket()`, `react()`, `reply()` |
| `src/handler.ts` | gate whitelist/self-chat → strip kata kunci → react ⏳ → Gemini → CalDAV/notes → react hasil. Ada guard `inFlight` anti-dobel; event tanpa waktu valid diturunkan jadi catatan |
| `src/gemini.ts` | prompt Bahasa Indonesia + `responseSchema` (`@google/genai`), inject tanggal/timezone sekarang, `parseLocal()` → Luxon |
| `src/caldav.ts` | build ICS (`ical-generator`) + `createCalendarObject` ke Radicale, cache kalender, `verifyConnection()` |
| `src/notes.ts` | catatan JSONL append-only |
| `src/config.ts` | validasi env pakai zod v4, `isWhitelisted()` cocokkan **9 digit terakhir** biar `+6281…` = `081…` |
| `src/logger.ts` | pino + pino-pretty |
| `Dockerfile`, `docker-compose.yml` | service bot + Radicale (`tomsquest/docker-radicale`), Radicale bind ke `127.0.0.1` saja |
| `radicale/config/config` | htpasswd bcrypt, storage `/data/collections` |
| `.env.example` | semua key konfigurasi |

Semua dependency **dipin exact** (tanpa `^`). Baileys pakai dist-tag `legacy` = `6.7.24`,
bukan `latest` (`7.0.0-rc14`) karena rc belum stabil.

### Status verifikasi

- ✅ `npm install` — 151 package, 0 vulnerability
- ✅ `npm run typecheck` — bersih
- ❌ Belum pernah dijalankan sungguhan (butuh `GEMINI_API_KEY` + Radicale hidup)
- ❌ Docker image belum di-build

### Toolchain PC user

Node `v24.15.0`, npm `11.12.1`, git `2.52.0.windows.1`. Java hanya **JRE 1.8.0_461**
(tidak ada JDK 17) — inilah sebabnya app Android tidak pernah bisa dikompilasi.

### Server tujuan deploy (sudah dicek 2026-08-27)

Hostname `cupserver`. Debian 13 (trixie) 13.6, arsitektur `x86_64`, Node `v24.19.0`,
Docker `26.1.5+dfsg1`, Docker Compose `2.26.1`. Semua syarat terpenuhi — **deploy pakai
Docker Compose**, tidak perlu systemd.

Catatan penyesuaian: image Radicale dipin ke `3.7.6.0` (tag terbaru), base image bot
`node:24-alpine` menyamai Node server, container bot jalan sebagai user `node` (uid 1000),
sehingga folder `data/` dan `radicale/data/` di host harus `chown 1000:1000`.

---

## 4. TODO berikutnya

- [x] Cek kesiapan server user — Debian 13 / x86_64 / Node 24 / Docker 26 + Compose 2.26
- [ ] Salin folder `server/` ke server (git clone atau rsync)
- [ ] Isi `.env` di server: `GEMINI_API_KEY`, `WHITELIST`, `CALDAV_USERNAME/PASSWORD/CALENDAR`
- [ ] `sudo apt install apache2-utils` lalu `htpasswd -B -c radicale/config/users <nama>`
- [ ] `mkdir -p data radicale/data && sudo chown -R 1000:1000 data radicale/data`
- [ ] `docker compose up -d --build`, scan QR dari `docker compose logs -f bot`
- [ ] Buat kalender di web UI Radicale (SSH tunnel ke `127.0.0.1:5232`), samakan dengan `CALDAV_CALENDAR`, lalu `docker compose restart bot`
- [ ] Reverse proxy + HTTPS (Caddy) sebelum HP akses dari luar jaringan
- [ ] Pasang DAVx5 di HP (F-Droid, gratis), tambah akun via URL
- [ ] Uji end-to-end: kirim "besok jam 3 meeting" ke diri sendiri
- [ ] Putuskan nasib folder `app/` (lihat bagian 5)

---

## 5. Folder `app/` — Android, sudah digantikan

Implementasi Android lengkap (Kotlin + Compose, package `com.yusuf.wareminder`,
`NotificationListenerService` + `CalendarContract` + Room + WorkManager + 4 layar Compose)
**masih ada di disk** tapi tidak dipakai lagi setelah user memilih Opsi B. Belum pernah
dikompilasi karena PC tidak punya JDK 17.

**Jangan hapus tanpa konfirmasi eksplisit user.**

Detail arsitektur lama disimpan di bagian 6 sebagai arsip.

---

## 6. Arsip — rencana Android (Opsi A, tidak dipakai)

### 6.1 Kendala teknis jalur on-device

WhatsApp **tidak punya API untuk membaca isi chat di HP**:

- Database `msgstore.db` terenkripsi, hanya bisa dibaca kalau HP di-root.
- Tidak ada intent/content provider publik dari WhatsApp.
- `whatsapp-web.js` / Baileys bisa baca chat penuh **tapi melanggar ToS WhatsApp** dan berisiko nomor kena banned.
- WhatsApp Cloud API resmi hanya untuk akun Business + verifikasi Meta.

Maka satu-satunya jalan legal & tanpa root untuk kasus user adalah
**`NotificationListenerService`** — menangkap notifikasi WhatsApp yang masuk.

Ini tetap memenuhi kebutuhan user, karena pesan dari nomor lain ke nomor user
**pasti** memunculkan notifikasi. User tidak perlu membuka WhatsApp sama sekali.

Batasan yang harus diingat & sebaiknya ditulis di UI app:

- Chat yang **di-mute** tidak selalu memunculkan notifikasi.
- Kalau pesan sudah dibaca di device lain (WhatsApp Web/desktop), notifikasi bisa hilang.
- Notifikasi bisa ter-**bundle** ("3 pesan baru") → perlu handling `EXTRA_TEXT_LINES`.
- Baterai: app harus di-whitelist dari battery optimization.

---

### 6.2 Keputusan lama (sudah tidak berlaku)

| Aspek | Keputusan |
|---|---|
| Arsitektur | Opsi A — app Android on-device, `NotificationListenerService` |
| Stack | **Kotlin + Jetpack Compose** (user awalnya pilih Flutter, lalu setuju ganti Kotlin karena ~90% fitur ini native) |
| LLM ekstraksi | **Google Gemini `gemini-2.0-flash`** (ada free tier, bagus untuk Bahasa Indonesia) |
| Output | Event di kalender bawaan + reminder/alarm + catatan di Room DB + **notifikasi konfirmasi sebelum disimpan** |
| Filter pengirim | **Whitelist nomor (wajib)** + **kata kunci opsional** (`/catat`, `/ingatkan`) — semua diatur di Settings |
| Install toolchain | **TIDAK** — user minta tulis kode dulu, build sendiri nanti di Android Studio |

Detail filter yang disetujui user:

> Whitelist nomor wajib. Kalau toggle kata kunci **ON** di Settings, hanya pesan
> berawalan `/catat` atau `/ingatkan` yang diproses. Kalau **OFF**, semua pesan
> dari nomor whitelist diproses.

---

### 6.3 Status toolchain Android di PC user

| Komponen | Status | Catatan |
|---|---|---|
| Flutter SDK | ❌ Tidak ada | Tidak dibutuhkan lagi (stack pindah ke Kotlin) |
| Android Studio | ❌ Tidak ada | User perlu install untuk build |
| Java | ⚠️ Hanya **JRE 1.8.0_461** | Butuh **JDK 17** untuk build Android modern |
| Android SDK | ✅ Ada di `C:\Users\Yusuf\AppData\Local\Android\Sdk` | Sudah ada `build-tools`, `platforms`, `platform-tools`, `emulator`. **Belum ada `cmdline-tools`** |
| git | ✅ `C:\Program Files\Git\cmd\git.exe` | |
| winget | ✅ tersedia | |

Kalau nanti user mau build dari terminal, yang perlu diinstall:

```powershell
winget install --id Microsoft.OpenJDK.17 -e
# lalu install cmdline-tools lewat Android Studio SDK Manager
```

Paling praktis: **install Android Studio**, lalu buka folder project ini — Gradle sync akan menarik sisanya.

---

### 6.4 Rencana arsitektur app

```
Notifikasi WhatsApp masuk
        ↓
NotificationListenerService  (tangkap sender + isi pesan)
        ↓
Filter: whitelist nomor  →  (opsional) cek prefix /catat atau /ingatkan
        ↓
WorkManager enqueue  (biar tahan proses lama & retry kalau offline)
        ↓
Gemini gemini-2.0-flash  →  balikin JSON terstruktur
        ↓
   ┌────────────────┬─────────────────┐
   │ type = event   │ type = note     │
   ↓                ↓
CalendarContract   Room DB (notes)
+ Reminder row
        ↓
Notifikasi konfirmasi ke user  [Setujui] / [Tolak] / [Edit]
```

### Package
`com.yusuf.wareminder`
### Modul / file yang direncanakan

| Layer | File | Isi |
|---|---|---|
| Manifest & Gradle | `app/build.gradle.kts`, `AndroidManifest.xml` | minSdk 26, compileSdk 35, permission kalender + notifikasi |
| Data | `data/AppDatabase.kt`, `NoteEntity.kt`, `PendingEntity.kt`, `Dao.kt` | Room: catatan + item pending konfirmasi |
| Data | `data/SettingsStore.kt` | DataStore: API key Gemini, whitelist nomor, toggle kata kunci, kalender tujuan, offset reminder |
| Listener | `service/WaNotificationListener.kt` | `NotificationListenerService`, handle `EXTRA_TEXT_LINES` untuk notif bundled, dedup pesan |
| AI | `ai/GeminiClient.kt` | Panggil REST Gemini, prompt Bahasa Indonesia, parse JSON |
| AI | `ai/ExtractionResult.kt` | Model: `type` (event/note/ignore), `title`, `datetimeStart`, `datetimeEnd`, `note`, `confidence` |
| Kalender | `calendar/CalendarWriter.kt` | Query `CalendarContract.Calendars`, insert `Events` + `Reminders` |
| Background | `work/ProcessMessageWorker.kt` | WorkManager: ekstraksi → simpan / minta konfirmasi |
| Notifikasi | `notify/ConfirmNotifier.kt`, `ConfirmReceiver.kt` | Notifikasi aksi Setujui/Tolak |
| Balasan WA | `service/ReplyRegistry.kt` | Balas ✅/❌ ke chat lewat action Reply (RemoteInput) di notifikasi WhatsApp. React emoji tidak bisa **lewat jalur notifikasi** — tapi bisa lewat Baileys (lihat bagian 2). |
| UI | `ui/HomeScreen.kt`, `PendingScreen.kt`, `NotesScreen.kt`, `SettingsScreen.kt` | Compose + Material 3 |
| UI | `MainActivity.kt` | Navigation, minta izin, cek status listener |

### Izin yang dibutuhkan

```xml
<uses-permission android:name="android.permission.READ_CALENDAR"/>
<uses-permission android:name="android.permission.WRITE_CALENDAR"/>
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>
```

Plus service:

```xml
<service
    android:name=".service.WaNotificationListener"
    android:exported="false"
    android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
    <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService"/>
    </intent-filter>
</service>
```

Package WhatsApp yang dipantau: `com.whatsapp` dan `com.whatsapp.w4b` (Business).

### Kontrak JSON dari Gemini

```json
{
  "type": "event | note | ignore",
  "title": "string",
  "datetime_start": "ISO-8601 atau null",
  "datetime_end": "ISO-8601 atau null",
  "all_day": false,
  "location": "string atau null",
  "note": "string atau null",
  "confidence": 0.0
}
```

Prompt harus diberi **tanggal & timezone sekarang** supaya "besok jam 3" / "Senin depan"
bisa diresolusi benar. Timezone default: `Asia/Jakarta` (bisa diubah di Settings).

---

### 6.5 Progres kode Android

Semua kode Android sudah ditulis (Room, listener, Gemini client, CalendarWriter, WorkManager,
4 layar Compose), **tapi belum pernah dikompilasi** karena PC hanya punya JRE 8.
Kalau suatu saat mau dilanjutkan: install Android Studio, buka folder project, Gradle sync
akan generate `gradlew` + wrapper jar; `local.properties` sudah menunjuk ke Android SDK.

---

## 7. Catatan penting untuk sesi berikutnya

1. **Jangan** ganti target ke Google Calendar. User sudah menolak dua kali.
2. Baileys **sudah disetujui user** untuk pemakaian pribadi (bukan blast). Tetap ingatkan
   risiko nomor kena ban kalau nanti ada rencana kirim pesan massal.
3. Stack aktif: **Node.js + TypeScript + Baileys + Radicale (CalDAV) + DAVx5**. Folder `app/`
   (Kotlin) sudah jadi arsip.
4. User **tidak mau** install toolchain tanpa izin — jangan jalankan `winget install` sendiri.
5. **Jangan hardcode API key.** Semua rahasia lewat `.env`, dan `.env` sudah di-gitignore.
6. Jangan ekspos port Radicale `5232` ke internet tanpa TLS — Basic auth tanpa HTTPS
   mengirim password polos.
7. Bahasa komunikasi ke user: **Bahasa Indonesia**, gaya singkat.
