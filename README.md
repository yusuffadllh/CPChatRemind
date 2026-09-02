<h1 align="center">CPChatRemind</h1>

<p align="center">
  Chat ke WhatsApp seperti biasa — acaranya muncul sendiri di Kalender HP.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-24-5FA04E?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="Baileys" src="https://img.shields.io/badge/WhatsApp-Baileys-25D366?logo=whatsapp&logoColor=white">
  <img alt="Gemini" src="https://img.shields.io/badge/AI-Gemini-4285F4?logo=googlegemini&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white">
</p>

---

## Apa ini

Bot WhatsApp pribadi yang membaca pesanmu, memahami maksudnya dengan Gemini, lalu
menuliskannya ke **aplikasi Kalender bawaan Android**, menyimpannya sebagai catatan,
atau mengingatkanmu balik lewat WhatsApp sebelum tenggat tugas.

Tidak ada form, tidak ada tombol. Kirim pesan ke chat *Pesan ke Diri Sendiri* dengan awalan
`/catat`, `/ingatkan`, `/tugas`, atau `/simpan`:

| Kamu kirim | Bot balas | Hasil |
| --- | --- | --- |
| `/ingatkan besok jam 3 meeting sama tim` | 📅 | Event besok 15:00 + reminder 30 menit sebelumnya |
| `/ingatkan Senin depan bayar listrik` | 📅 | Event Senin 09:00 (jam default) |
| `/tugas laporan PCV, deadline 20 Okt` | 🎯 | Bot nge-WA kamu berlapis sebelum tenggat |
| `/catat wifi rumah passwordnya 12345` | 📝 | Tersimpan sebagai catatan |
| foto + keterangan `/simpan struk` | 💾 | Berkasnya ikut disimpan di server |
| `haha iya bener` | — | Tanpa awalan, diabaikan sepenuhnya |

Awalan itu membuat obrolan biasa tidak pernah dikirim ke Gemini — lebih hemat kuota dan
lebih privat. Kalau mau bot membaca semua pesan, set `REQUIRE_KEYWORD=false`.

React emoji di pesanmu berfungsi sebagai status: ⏳ sedang diproses, 📅 event dibuat,
🎯 jadi tugas, 📝 dicatat, 💾 berkas tersimpan, 🤷 diabaikan, ❌ gagal (bot juga mengutip
pesan dan menyebut alasannya).

## Cara kerja

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
   ┌────┬────────────────┬────────────┐
   ▼                     ▼              ▼
CalDAV (Radicale)      data/notes.jsonl  data/tasks.jsonl
+ VALARM reminder                         │
        │                    react 📅 / 🎯 / 📝 / 🤷 / ❌
        │                                 ▼
        │                    penjadwal tiap menit → bot nge-WA kamu
        ▼
DAVx5 di HP  →  Kalender bawaan Android
```

Sisi server terhubung ke WhatsApp sebagai **perangkat tertaut** — sama seperti WhatsApp
Web, jadi HP tidak perlu dipasangi aplikasi apa pun dan tidak perlu di-root.

## Kenapa lewat CalDAV

`CalendarContract` Android adalah content provider lokal — hanya bisa ditulis oleh proses
yang berjalan **di dalam HP**. Bot yang hidup di server tidak akan pernah bisa
menyentuhnya secara langsung. Radicale (server CalDAV) + DAVx5 menjembatani itu tanpa perlu
memasang APK apa pun.

Ini juga bukan Google Calendar: datanya tinggal di servermu sendiri.

## Fitur

- **Chat ke diri sendiri didukung.** Tidak butuh nomor kedua.
- **Bahasa natural Indonesia.** `besok`, `Senin depan`, `nanti sore`, campur bahasa gaul.
- **Reminder otomatis** sebelum acara (`VALARM`, default 30 menit).
- **Pengingat tugas berlapis.** `/tugas` tidak masuk kalender; bot yang nge-WA kamu beberapa
  kali sebelum tenggat, dan jaraknya disesuaikan dengan taksiran kesulitan tugasnya
  (Gemini boleh mencari di Google supaya teknologi tidak umum tidak diremehkan).
- **Foto & video tersimpan** lewat `/simpan`, dikelompokkan per bulan di `data/media/`.
- **Status lewat react emoji**, jadi terlihat langsung di chat tanpa balasan berisik.
- **Aktif hanya saat dipanggil.** Kata kunci `/catat` · `/ingatkan` · `/note` · `/tugas` ·
  `/simpan`, plus whitelist nomor kalau mau menerima perintah dari orang lain.
- **Turun kelas dengan aman**: kalau Gemini bilang "event" tapi waktunya tidak jelas,
  otomatis disimpan sebagai catatan alih-alih membuat event ngawur.
- **Tanpa database.** Catatan ditulis sebagai JSONL, deploy tetap sederhana.
- **Self-hosted penuh.** Satu `docker compose up` untuk bot + server kalender.

## Mulai

Butuh: server Linux dengan Docker, API key [Google AI Studio](https://aistudio.google.com/apikey),
dan HP Android.

```bash
git clone https://github.com/yusuffadllh/CPChatRemind.git
cd CPChatRemind/server

cp .env.example .env
$EDITOR .env                   # GEMINI_API_KEY, CALDAV_USERNAME, CALDAV_PASSWORD

sudo apt install -y apache2-utils
htpasswd -B -c radicale/config/users yusuf

mkdir -p data radicale/data
sudo chown -R 1000:1000 data radicale/data

docker compose up -d radicale   # buat kalender dulu di http://127.0.0.1:5232/
docker compose up -d --build bot
docker compose logs -f bot      # scan QR dari HP
```

Scan QR lewat WhatsApp → Setelan → **Perangkat tertaut** → Tautkan perangkat.

Langkah lengkap — konfigurasi `.env`, reverse proxy HTTPS, membuat kalender di Radicale,
dan setup DAVx5 di HP — ada di **[server/README.md](server/README.md)**.

> [!WARNING]
> Baileys adalah klien WhatsApp **tidak resmi**. Nomor bisa diblokir Meta. Project ini
> ditujukan untuk pencatatan pribadi — jangan dipakai untuk blast atau spam.

> [!CAUTION]
> Radicale hanya di-bind ke `127.0.0.1`. Jangan ekspos port `5232` langsung ke internet:
> Basic auth tanpa TLS mengirim password dalam bentuk polos. Untuk akses dari HP, pakai
> Tailscale Serve, Cloudflare Tunnel, atau reverse proxy HTTPS — lihat
> [server/README.md](server/README.md).

## Stack

| Bagian | Teknologi |
| --- | --- |
| Runtime | Node.js 24 + TypeScript (ESM, strict) |
| WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) |
| LLM | Google Gemini via [`@google/genai`](https://www.npmjs.com/package/@google/genai) |
| Kalender | [Radicale](https://radicale.org/) (CalDAV) + `tsdav` + `ical-generator` |
| Sync ke HP | [DAVx5](https://www.davx5.com/) → Kalender bawaan Android |
| Akses HP | Tailscale Serve / Cloudflare Tunnel / reverse proxy HTTPS |
| Pendukung | zod (validasi env), luxon (zona waktu), pino (log) |
| Deploy | Docker Compose |

## Struktur

```
server/              bot Node.js + TypeScript  ← yang dipakai
  src/               kode sumber
  radicale/config/   konfigurasi Radicale
  docker-compose.yml bot + Radicale
app/                 arsip: app Android Kotlin + Compose (tidak dipakai lagi)
HANDOVER.md          catatan konteks & keputusan desain
```

Folder `app/` adalah pendekatan awal berbasis `NotificationListenerService`. Ditinggalkan
karena dua hal: chat ke diri sendiri tidak memunculkan notifikasi, dan notifikasi WhatsApp
tidak mengekspos aksi react. Latar belakang lengkapnya ada di [HANDOVER.md](HANDOVER.md).

## Lisensi

Belum ditentukan. Project pribadi.
