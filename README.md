# CPChatRemind

Bot WhatsApp pribadi: kirim pesan biasa ke WhatsApp, lalu Gemini mengubahnya jadi
**event di aplikasi Kalender bawaan Android** atau **catatan**.

Kirim `besok jam 3 meeting sama tim` ke chat *Pesan ke Diri Sendiri*, bot bereaksi 📅,
dan acaranya muncul di kalender HP lengkap dengan reminder.

```
Pesan WA (termasuk "Pesan ke Diri Sendiri")
        │
        ▼
Baileys — sesi perangkat tertaut          react ⏳
        │
        ▼
Filter: whitelist nomor / self-chat / prefix kata kunci
        │
        ▼
Gemini → JSON { type, title, datetime_start, location, ... }
        │
   ┌────┴────────────────────┐
   ▼                         ▼
CalDAV (Radicale)      data/notes.jsonl
+ VALARM reminder
        │                    react 📅 / 📝 / 🤷 / ❌
        ▼
DAVx5 di HP  →  Kalender bawaan Android
```

## Kenapa lewat CalDAV, bukan tulis kalender langsung

`CalendarContract` Android adalah content provider lokal — hanya bisa ditulis oleh proses
yang berjalan **di dalam HP**. Bot di server tidak akan pernah bisa menyentuhnya langsung.
CalDAV + DAVx5 menjembatani itu tanpa perlu memasang APK apa pun.

Ini juga bukan Google Calendar. Datanya ada di server sendiri (Radicale).

## Fitur

- Baca pesan lewat sesi **perangkat tertaut** WhatsApp, termasuk chat ke diri sendiri
- Ekstraksi bahasa natural Indonesia dengan Gemini (`besok`, `Senin depan`, `sore`, dll.)
- React emoji sebagai status: ⏳ diproses, 📅 event dibuat, 📝 dicatat, 🤷 diabaikan, ❌ gagal
- Reminder otomatis sebelum acara (`VALARM`, default 30 menit)
- Filter whitelist nomor + prefix kata kunci opsional (`/catat`, `/ingatkan`)
- Catatan disimpan sebagai JSONL, tanpa perlu database

## Peringatan

Baileys adalah klien WhatsApp **tidak resmi**. Nomor bisa diblokir Meta. Project ini
ditujukan untuk pencatatan pribadi — jangan dipakai untuk blast atau spam.

## Jalankan

Kode server ada di [server/](server), lengkap dengan Docker Compose (bot + Radicale).
Panduan instalasi, konfigurasi `.env`, deploy, dan setup DAVx5 di HP: **[server/README.md](server/README.md)**.

Ringkasnya:

```bash
cd server
cp .env.example .env      # isi GEMINI_API_KEY, WHITELIST, CALDAV_*
docker compose up -d --build
docker compose logs -f bot     # scan QR dari HP
```

## Stack

| Bagian | Teknologi |
|---|---|
| Runtime | Node.js 24 + TypeScript (ESM) |
| WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) 6.7.x |
| LLM | Google Gemini via `@google/genai` |
| Kalender | [Radicale](https://radicale.org/) (CalDAV) + `tsdav` + `ical-generator` |
| Sync ke HP | [DAVx5](https://www.davx5.com/) → Kalender bawaan Android |
| Lain-lain | zod, luxon, pino |

## Struktur

```
server/           bot Node.js + TypeScript (yang dipakai)
  src/            kode sumber
  radicale/       konfigurasi Radicale
app/              arsip: app Android Kotlin + Compose (tidak dipakai lagi)
HANDOVER.md       catatan konteks & keputusan desain
```

Folder `app/` adalah pendekatan awal berbasis `NotificationListenerService`. Ditinggalkan
karena chat ke diri sendiri tidak memunculkan notifikasi dan notifikasi WhatsApp tidak
mengekspos aksi react. Latar belakangnya ada di [HANDOVER.md](HANDOVER.md).
