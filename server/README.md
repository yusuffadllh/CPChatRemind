# wa-reminder server

Bot WhatsApp pribadi: pesan masuk → Gemini ekstrak → event di CalDAV (Radicale) atau catatan JSONL.
Di HP, DAVx5 men-sync Radicale sehingga event muncul di **aplikasi Kalender bawaan Android**.

```
Pesan WA (termasuk "Pesan ke Diri Sendiri")
  → Baileys (perangkat tertaut)  → react ⏳
  → filter whitelist / self-chat / kata kunci
  → Gemini  → event | note | ignore
  → CalDAV (event) atau notes.jsonl (catatan)
  → react 📅 / 📝 / 🤷 / ❌
```

## Peringatan

Baileys adalah klien tidak resmi. Nomor bisa diblokir WhatsApp. Pakai hanya untuk
pencatatan pribadi, jangan untuk blast/spam.

## Target server

Sudah diverifikasi cocok: Debian 13 (trixie), x86_64, Node v24.19.0, Docker 26.1.5,
Docker Compose 2.26.1. Deploy pakai Docker.

## Jalan lokal (dev)

```bash
cd server
cp .env.example .env      # isi GEMINI_API_KEY, WHITELIST, CALDAV_*
npm install
npm run typecheck
npm run dev               # QR muncul di terminal
```

Scan QR: WhatsApp → Setelan → **Perangkat tertaut** → Tautkan perangkat.
Sesi tersimpan di `data/auth/`. Jangan commit folder ini.

## Deploy dengan Docker

```bash
# 1. Salin project ke server
git clone <repo> wa-reminder && cd wa-reminder/server
# atau: rsync -av --exclude node_modules --exclude data ./server/ user@server:~/wa-reminder/server/

# 2. Konfigurasi
cp .env.example .env
$EDITOR .env          # GEMINI_API_KEY, WHITELIST, CALDAV_USERNAME, CALDAV_PASSWORD, CALDAV_CALENDAR

# 3. User Radicale (htpasswd dari paket apache2-utils)
sudo apt install -y apache2-utils
htpasswd -B -c radicale/config/users yusuf

# 4. Folder data; uid 1000 = user `node` di container bot & `radicale` di image Radicale
mkdir -p data radicale/data
sudo chown -R 1000:1000 data radicale/data

# 5. Jalankan
docker compose up -d --build
docker compose logs -f bot    # QR muncul di sini, scan dari HP
```

Scan QR lewat WhatsApp → Setelan → **Perangkat tertaut** → Tautkan perangkat.

Setelah itu buat kalender di web UI Radicale (`http://127.0.0.1:5232/`, atau lewat SSH
tunnel `ssh -L 5232:127.0.0.1:5232 user@server`), login pakai user tadi, lalu samakan nama
kalendernya dengan `CALDAV_CALENDAR` di `.env` dan `docker compose restart bot`.

`CALDAV_URL` tidak perlu diisi di `.env` — compose meng-override-nya ke
`http://radicale:5232/` (jaringan internal Docker, tidak lewat internet).

Radicale hanya di-bind ke `127.0.0.1`. Untuk diakses HP dari luar, taruh di belakang
reverse proxy dengan HTTPS (Caddy/nginx + Let's Encrypt). **Jangan** ekspos port 5232
langsung ke internet — Basic auth tanpa TLS mengirim password polos.

Contoh Caddyfile:

```
caldav.domain-kamu {
    reverse_proxy 127.0.0.1:5232
}
```

## Setup HP (DAVx5)

1. Pasang **DAVx5** dari F-Droid (gratis) atau Play Store (berbayar).
2. Tambah akun → *Login dengan URL dan nama pengguna*.
3. URL = `https://caldav.domain-kamu/`, username + password Radicale.
4. Centang kalender yang mau di-sync.
5. Atur interval sync (default 15 menit; bisa dipercepat di setelan akun).

Event akan muncul di Kalender bawaan Android beserta remindernya.

## Konfigurasi (.env)

| Key | Arti |
| --- | --- |
| `GEMINI_API_KEY` | API key Google AI Studio |
| `GEMINI_MODEL` | mis. `gemini-2.5-flash` |
| `WHITELIST` | nomor yang diizinkan, dipisah koma; kosong = tolak semua non-self |
| `ALLOW_SELF_CHAT` | `true` agar "Pesan ke Diri Sendiri" diproses |
| `REQUIRE_KEYWORD` | `true` = hanya proses pesan berawalan `KEYWORDS` |
| `KEYWORDS` | mis. `/catat,/ingatkan,/note` |
| `TIMEZONE` | `Asia/Jakarta` |
| `REMINDER_MINUTES_BEFORE` | menit alarm sebelum event; `0` = tanpa alarm |
| `CALDAV_URL` / `CALDAV_USERNAME` / `CALDAV_PASSWORD` | koneksi Radicale |
| `CALDAV_CALENDAR` | nama kalender target; kosong = kalender pertama |
| `DATA_DIR` | lokasi `auth/` dan `notes.jsonl` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

## Struktur

| File | Isi |
| --- | --- |
| [src/index.ts](src/index.ts) | entrypoint, verifikasi CalDAV, start Baileys, shutdown |
| [src/whatsapp.ts](src/whatsapp.ts) | koneksi Baileys, QR, reconnect, `react()`, `reply()` |
| [src/handler.ts](src/handler.ts) | filter, alur react → ekstrak → simpan |
| [src/gemini.ts](src/gemini.ts) | prompt + schema ekstraksi terstruktur |
| [src/caldav.ts](src/caldav.ts) | buat ICS + PUT ke Radicale |
| [src/notes.ts](src/notes.ts) | catatan JSONL |
| [src/config.ts](src/config.ts) | validasi env (zod), pencocokan whitelist 9 digit akhir |
| [src/logger.ts](src/logger.ts) | pino |
