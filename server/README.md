# CPChatRemind — server

Bot Baileys yang mengubah pesan WhatsApp menjadi event CalDAV atau catatan.
Untuk gambaran umum project, lihat [README utama](../README.md).

```
Pesan WA → Baileys → react ⏳ → filter → Gemini → CalDAV / notes.jsonl → react 📅 📝 🤷 ❌
```

Secara default bot hanya menanggapi pesan berawalan `/catat`, `/ingatkan`, atau `/note`.

## Prasyarat

| Kebutuhan | Keterangan |
| --- | --- |
| Server Linux | Sudah diverifikasi di Debian 13 (trixie), x86_64 |
| Docker | 26.x + Compose 2.x (jalur deploy yang direkomendasikan) |
| Node.js | ≥ 22 — hanya kalau mau jalan tanpa Docker |
| API key Gemini | Gratis di [Google AI Studio](https://aistudio.google.com/apikey) |
| HP Android | Untuk DAVx5 + Kalender bawaan |

## Deploy dengan Docker

### 1. Ambil kode

```bash
git clone https://github.com/yusuffadllh/CPChatRemind.git
cd CPChatRemind/server
```

### 2. Konfigurasi

```bash
cp .env.example .env
$EDITOR .env
```

Minimal yang wajib diisi: `GEMINI_API_KEY`, `CALDAV_USERNAME`, `CALDAV_PASSWORD`.
`CALDAV_URL` tidak perlu disentuh — Compose meng-override-nya ke `http://radicale:5232/`
melalui jaringan internal Docker.

### 3. Buat user Radicale

```bash
sudo apt install -y apache2-utils
htpasswd -B -c radicale/config/users yusuf
```

Password yang kamu masukkan di sini harus sama dengan `CALDAV_PASSWORD` di `.env`.

### 4. Siapkan folder data

```bash
mkdir -p data radicale/data
sudo chown -R 1000:1000 data radicale/data
```

uid 1000 adalah user `node` di container bot dan `radicale` di image Radicale. Tanpa
`chown`, container tidak bisa menulis ke bind mount.

### 5. Nyalakan Radicale dan buat kalender

Radicale tidak membuat kalender otomatis, dan bot menolak start kalau belum ada kalender.
Jadi nyalakan Radicale lebih dulu:

```bash
docker compose up -d radicale
```

Port 5232 sengaja hanya di-bind ke `127.0.0.1`, jadi akses dari laptop lewat tunnel SSH:

```bash
ssh -L 5232:127.0.0.1:5232 user@server
```

Sambil tunnel jalan, buka <http://127.0.0.1:5232/>, login dengan user tadi, lalu
**Create new addressbook or calendar** → tipe *calendar* → beri nama.

Kalau kamu hanya membuat satu kalender, `CALDAV_CALENDAR` boleh tetap kosong — bot memakai
kalender pertama yang ditemukan.

### 6. Nyalakan bot dan tautkan WhatsApp

```bash
docker compose up -d --build bot
docker compose logs -f bot
```

QR muncul di log. Scan lewat WhatsApp → Setelan → **Perangkat tertaut** → Tautkan
perangkat. Sesi tersimpan di `data/auth/`, jadi restart tidak perlu scan ulang.

Log `WhatsApp tersambung` menandakan bot siap.

## Akses dari HP: pilih satu

Radicale hanya di-bind ke `127.0.0.1:5232`. DAVx5 di HP perlu jalan masuk yang ber-HTTPS —
Basic auth tanpa TLS mengirim password dalam bentuk polos. Jangan pernah mengganti binding
menjadi `0.0.0.0:5232`.

### Opsi 1 — Tailscale Serve (paling praktis)

Kalau server sudah di dalam tailnet, satu perintah sudah cukup:

```bash
sudo tailscale serve --bg --https=443 127.0.0.1:5232
tailscale serve status
```

Sertifikat TLS diterbitkan otomatis dan URL-nya jadi
`https://<nama-server>.<tailnet>.ts.net/`. Tidak perlu domain, tidak perlu buka port di
firewall, dan `--bg` membuatnya bertahan setelah reboot.

Syaratnya HP juga terpasang Tailscale dan login ke tailnet yang sama. Karena tidak melewati
internet publik, ini sekaligus paling aman.

Kalau port 443 di tailnet sudah dipakai layanan lain (File Browser, Syncthing), pakai port
lain lalu sertakan port itu di URL DAVx5:

```bash
sudo tailscale serve --bg --https=8443 127.0.0.1:5232
```

Mematikan: ulangi perintahnya dengan menambahkan `off` di akhir.

### Opsi 2 — Cloudflare Tunnel

Kalau HP tidak selalu di tailnet dan kamu ingin akses dari internet:

```bash
cloudflared tunnel create caldav
cloudflared tunnel route dns caldav caldav.domain-kamu
```

Tambahkan ke `~/.cloudflared/config.yml`:

```yaml
ingress:
  - hostname: caldav.domain-kamu
    service: http://127.0.0.1:5232
  - service: http_status:404
```

Tidak perlu membuka port apa pun di firewall. Karena endpoint-nya publik, aktifkan
Cloudflare Access kalau ingin lapisan autentikasi tambahan di atas Basic auth Radicale.

### Opsi 3 — Caddy

Butuh domain yang mengarah ke IP server dan port 80 + 443 terbuka:

```
caldav.domain-kamu {
    reverse_proxy 127.0.0.1:5232
}
```

## Setup HP (DAVx5)

1. Pasang **DAVx5** — gratis di [F-Droid](https://f-droid.org/packages/at.bitfire.davdroid/),
   berbayar di Play Store (sama saja, versi Play Store itu bentuk donasi).
2. Tambah akun → *Login dengan URL dan nama pengguna*.
3. URL sesuai opsi yang kamu pilih di atas:
   - Tailscale Serve → `https://<nama-server>.<tailnet>.ts.net/`
   - Cloudflare Tunnel / Caddy → `https://caldav.domain-kamu/`
4. Username + password Radicale, lalu **Login**.
5. Centang kalender yang mau di-sync.
6. Atur interval sync di setelan akun (default 15 menit).

Event beserta remindernya akan muncul di aplikasi Kalender bawaan Android.

> Sync DAVx5 memakai polling, jadi ada jeda antara bot menulis event dan event terlihat di
> HP. Percepat intervalnya kalau jeda 15 menit terasa lama.

## Jalan lokal tanpa Docker

```bash
cd server
cp .env.example .env
npm install
npm run typecheck
npm run dev            # tsx watch, QR muncul di terminal
```

Butuh Radicale (atau server CalDAV lain) yang sudah hidup dan `CALDAV_URL` menunjuk ke sana.

| Script | Fungsi |
| --- | --- |
| `npm run dev` | Jalan dengan auto-reload |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile ke `dist/` |
| `npm start` | Jalankan hasil build |

## Konfigurasi (.env)

**Gemini**

| Key | Default | Arti |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Wajib. API key Google AI Studio |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Model yang dipakai |

**Siapa yang boleh menyuruh bot**

| Key | Default | Arti |
| --- | --- | --- |
| `ALLOW_SELF_CHAT` | `true` | Proses pesan dari chat ke nomor sendiri |
| `WHITELIST` | kosong | Nomor lain yang diizinkan, dipisah koma. Format bebas (`+62…`, `08…`) — dicocokkan lewat 9 digit terakhir. Kosong = hanya self-chat |
| `REQUIRE_KEYWORD` | `true` | Hanya proses pesan berawalan `KEYWORDS`. Set `false` kalau mau semua pesan dibaca |
| `KEYWORDS` | `/catat,/ingatkan,/note` | Awalan yang diterima; dicocokkan tanpa peduli huruf besar-kecil, dan otomatis dibuang dari judul |

**Waktu**

| Key | Default | Arti |
| --- | --- | --- |
| `TIMEZONE` | `Asia/Jakarta` | Dipakai untuk resolusi "besok", "sore", dll. |
| `REMINDER_MINUTES_BEFORE` | `30` | Menit alarm sebelum event; `0` = tanpa alarm |

**CalDAV**

| Key | Default | Arti |
| --- | --- | --- |
| `CALDAV_URL` | `http://localhost:5232/` | Di-override oleh Compose |
| `CALDAV_USERNAME` / `CALDAV_PASSWORD` | — | Kredensial Radicale |
| `CALDAV_CALENDAR` | kosong | Nama kalender tujuan; kosong = kalender pertama |

**Lain-lain**

| Key | Default | Arti |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Lokasi `auth/` dan `notes.jsonl` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Struktur kode

| File | Isi |
| --- | --- |
| [src/index.ts](src/index.ts) | Entrypoint: verifikasi CalDAV, start Baileys, shutdown SIGINT/SIGTERM |
| [src/whatsapp.ts](src/whatsapp.ts) | Koneksi Baileys, QR, reconnect, deteksi self-chat, `react()`, `reply()` |
| [src/handler.ts](src/handler.ts) | Alur: filter → react ⏳ → ekstrak → simpan → react hasil |
| [src/gemini.ts](src/gemini.ts) | Prompt Bahasa Indonesia + response schema terstruktur |
| [src/caldav.ts](src/caldav.ts) | Bangun ICS + `PUT` ke Radicale, cache kalender |
| [src/notes.ts](src/notes.ts) | Catatan JSONL append-only |
| [src/config.ts](src/config.ts) | Validasi env dengan zod, pencocokan whitelist 9 digit akhir |
| [src/logger.ts](src/logger.ts) | pino + pino-pretty |

## Data di disk

```
data/
  auth/            sesi WhatsApp — RAHASIA, setara akses penuh ke akunmu
  notes.jsonl      catatan, satu JSON per baris
radicale/data/     penyimpanan kalender Radicale
radicale/config/
  config           konfigurasi Radicale
  users            hash password (bcrypt) — tidak di-commit
```

`data/`, `radicale/data/`, `radicale/config/users`, dan `.env` semuanya sudah masuk
`.gitignore`.

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| Bot berhenti dengan pesan sesi dicabut | Perangkat tertaut dihapus dari HP. Hapus `data/auth/` lalu scan QR lagi |
| `Kalender "X" tidak ditemukan` | Nama `CALDAV_CALENDAR` tidak sama dengan di Radicale. Log menampilkan daftar yang tersedia |
| Container gagal tulis ke `data/` | Bind mount belum di-`chown 1000:1000` |
| Pesan tidak diproses sama sekali | Pesan harus berawalan `/catat`, `/ingatkan`, atau `/note` (default `REQUIRE_KEYWORD=true`). Cek juga `ALLOW_SELF_CHAT` / `WHITELIST` |
| Event dibuat tapi tidak muncul di HP | Sync DAVx5 masih menunggu polling; tarik-untuk-refresh atau percepat intervalnya |
| Waktu event ngawur | `TIMEZONE` salah, atau pesannya memang ambigu — cek `LOG_LEVEL=debug` untuk melihat hasil ekstraksi |

Log terstruktur: `docker compose logs -f bot`. Set `LOG_LEVEL=debug` untuk melihat JSON
hasil ekstraksi Gemini per pesan.
