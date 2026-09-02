# CPChatRemind — server

Bot Baileys yang mengubah pesan WhatsApp menjadi event CalDAV, catatan, atau
pengingat tugas yang dikirim balik lewat WhatsApp.
Untuk gambaran umum project, lihat [README utama](../README.md).

```
Pesan WA → Baileys → react ⏳ → filter → [simpan foto/video] → Gemini → CalDAV / notes.jsonl / tasks.jsonl → react 📅 🎯 📝 💾 🤷 ❌
                                                                                        ↓
                                                       penjadwal tiap menit → pengingat tugas via WA
```

Secara default bot hanya menanggapi pesan berawalan `/catat`, `/ingatkan`, `/note`,
`/simpan`, atau `/tugas`.

## Perintah WhatsApp

| Perintah | Fungsi |
| --- | --- |
| `/catat wifi rumah 12345` | Simpan catatan (juga `/note`) |
| `/ingatkan besok jam 3 sore rapat` | Buat event + alarm di kalender HP |
| `/ingatkan besok jam 3 rapat, ingetin 2 jam sebelumnya` | Sama, tapi jam alarmnya diatur sendiri |
| `/tugas laporan PCV, deadline 20 Okt` | Bot yang nge-WA kamu berlapis sebelum tenggat (bukan event) |
| foto/video + keterangan `/simpan struk` | Berkasnya ikut disimpan ke server, sekalian dicatat |
| `/list` | 10 catatan terakhir; `/list 25` untuk lebih banyak (maks 30) |
| `/cari wifi` | Cari di judul dan isi catatan |
| `/agenda` | Event mendatang yang sudah tersimpan |
| `/bantuan` | Daftar perintah (juga `/help`, `/menu`, `/start`, `/?`) |

Perintah baca dijawab langsung dari `notes.jsonl` tanpa memanggil Gemini, jadi gratis
dan instan. Reaksi 📖 menandakan perintah baca berhasil dijalankan.

Pesan berawalan `/` yang bukan perintah apa pun dijawab dengan petunjuk singkat
(plus tebakan kalau ejaannya mirip, mis. `/agend` → `/agenda`), dan kata kunci tanpa
isi seperti `/catat` saja dibalas contoh pemakaian. Teks biasa tanpa `/` tetap
diabaikan tanpa balasan supaya obrolan normal tidak terganggu.

### Mengatur jam alarm

Waktu alarm ikut apa yang ditulis di pesan, tidak harus 30 menit terus:

| Ditulis di pesan | Alarm |
| --- | --- |
| `ingetin 15 menit sebelum` | 15 menit sebelum acara |
| `ingetin 2 jam sebelumnya` | 2 jam sebelum acara |
| `alarm sehari sebelum` | 1 hari sebelum acara |
| `pas jamnya` / `tepat waktu` | Tepat saat acara mulai |
| (tidak disebut) | Nilai `REMINDER_MINUTES_BEFORE` di `.env` |

Batas atas 7 hari (10080 menit). Balasan bot selalu menyebut alarm yang dipakai,
jadi kalau Gemini salah tangkap langsung kelihatan.

### Pengingat tugas (`/tugas`)

Bedanya dengan `/ingatkan`: tugas **tidak** masuk kalender. Botlah yang mengirim
pesan WhatsApp beberapa kali sebelum tenggat, dan jaraknya dihitung dari taksiran
kesulitan tugasnya — makin berat, makin awal diingatkan.

Pesan boleh beberapa baris dan berisi beberapa sub-pekerjaan, tulis apa adanya:

```
/tugas Project PCV
Bikin game berbasis HSV
Push di github dan buat readme sbg laporan
Deadline 20 Oktober
```

Balasannya menyebut tenggat, skor kesulitan, perkiraan lama kerja, alasan
taksirannya, dan daftar jam pengingatnya — jadi taksiran yang ngawur langsung
kelihatan dan bisa dikirim ulang dengan detail yang lebih jelas.

| Kesulitan | Pengingat pertama | Contoh |
| --- | --- | --- |
| 1 (sepele) | 2× lama kerja sebelum tenggat | isi form, upload berkas |
| 3 (sedang) | 3× lama kerja | laporan praktikum, tugas coding kecil |
| 5 (sangat berat) | 5× lama kerja, maks 30 hari | project besar, riset |

Setelah pengingat pertama, jaraknya meluruh separuh-separuh (mis. H-2.5 hari →
H-1.25 hari → H-15 jam), ditutup satu aba-aba terakhir maksimal 4 jam sebelum
tenggat. Lapisan yang terlalu berdempet dibuang otomatis.

Catatan penting:

- **Tenggat wajib punya tanggal.** "Deadline UTS" atau "pas kumpul" tidak bisa
  dijadwalkan; tugasnya tetap dicatat, tapi bot minta dikirim ulang begitu
  tanggalnya jelas. Bot sengaja tidak mengarang tanggal.
- Kalau tanggalnya disebut tanpa jam, dipakai 23:59.
- Tugas yang dicatat mepet tetap dapat pengingat: lapisan yang waktunya sudah
  lewat dikirim sekali di sapuan berikutnya, selama tenggatnya belum lewat.
- Begitu tenggat lewat, sisa pengingat dibatalkan dan tugasnya ditutup.
- Kalau kirim gagal (mis. socket sedang reconnect), lapisannya tetap `pending`
  dan dicoba lagi menit berikutnya.
- Taksiran kesulitan memakai Gemini dengan pencarian Google (`TASK_SEARCH_GROUNDING`),
  supaya teknologi yang tidak umum tidak diremehkan. Kalau Gemini gagal total,
  dipakai taksiran default 3/5 · 4 jam supaya pengingat tetap terjadwal.
- Status pengingat disimpan di `data/tasks.jsonl`. Beda dari `notes.jsonl` yang
  append-only, berkas ini ditulis ulang setiap ada perubahan status.

### Menyimpan foto & video

Hanya `/simpan` yang menulis berkas ke disk, dan hanya untuk foto dan video.
Audio, dokumen, dan stiker tidak diunduh. Kata kunci lain (`/catat`, `/note`,
`/ingatkan`) tetap mencatat keterangannya tanpa menyimpan berkasnya.

| Cara kirim | Hasil |
| --- | --- |
| Foto + keterangan `/simpan struk belanja` | Berkas tersimpan, catatan judulnya dari keterangan |
| Foto + keterangan `/simpan` saja | Berkas tersimpan, judul otomatis (mis. "Foto dari WhatsApp") |
| Balas foto lama lalu tulis `/simpan` | Berkas foto yang dibalas itu yang disimpan |
| Foto + keterangan `/catat struk belanja` | Cuma jadi catatan teks, berkas tidak disimpan |
| Foto + `/ingatkan besok jam 3 bayar ini` | Event dibuat, berkas tidak disimpan |
| Foto tanpa keterangan | Diabaikan (kecuali `REQUIRE_KEYWORD=false`) |

Balasan bot menyebut path relatifnya, mis.
`📎 foto 240 KB → media/2026-09/20260903-120000-ab12cd34.jpg`.

Catatan teknis:

- `/simpan` selalu dikenali walau tidak ditulis di `KEYWORDS`; kata kuncinya
  dipatok di kode ([src/config.ts](src/config.ts)) karena cuma jalur ini yang
  menulis berkas ke disk.
- Nama berkas dibuat sendiri dari waktu + UUID. Nama kiriman tidak pernah dipakai,
  jadi `../` atau karakter aneh tidak bisa menembus folder.
- Ekstensi diambil dari daftar mimetype yang dikenal; yang tidak dikenal jatuh ke
  `.jpg` untuk foto dan `.mp4` untuk video.
- Ukuran dicek dua kali: klaim pengirim (ditolak sebelum unduh) lalu isi sebenarnya.
- Kalau unduhan gagal tapi pesannya ada teks, catatan/event-nya tetap dibuat dan
  balasan menyebut ⚠️ lampiran tidak tersimpan.

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
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model yang dipakai. `gemini-2.0-flash` dijadwalkan mati 1 Juni 2026 |
| `GEMINI_RETRY_ATTEMPTS` | `4` | Percobaan ke Gemini (termasuk yang pertama) kalau balasannya 503 "high demand" / 429 / 5xx. Jeda naik 1s → 8s. Rentang 1–8 |

**Siapa yang boleh menyuruh bot**

| Key | Default | Arti |
| --- | --- | --- |
| `ALLOW_SELF_CHAT` | `true` | Proses pesan dari chat ke nomor sendiri |
| `WHITELIST` | kosong | Nomor lain yang diizinkan, dipisah koma. Format bebas (`+62…`, `08…`) — dicocokkan lewat 9 digit terakhir. Kosong = hanya self-chat |
| `REQUIRE_KEYWORD` | `true` | Hanya proses pesan berawalan `KEYWORDS`. Set `false` kalau mau semua pesan dibaca |
| `KEYWORDS` | `/catat,/ingatkan,/note` | Awalan yang diterima; dicocokkan tanpa peduli huruf besar-kecil, dan otomatis dibuang dari judul. `/simpan` dan `/tugas` selalu ikut walau tidak ditulis di sini |

**Foto & video**

| Key | Default | Arti |
| --- | --- | --- |
| `MEDIA_MAX_MB` | `25` | Batas ukuran foto/video yang diunduh ke `data/media/` lewat `/simpan`. Lebih besar ditolak. Rentang 1–100 |

**Pengingat tugas**

| Key | Default | Arti |
| --- | --- | --- |
| `TASK_SEARCH_GROUNDING` | `true` | Izinkan Gemini mencari di Google saat menaksir kesulitan tugas. Lebih akurat untuk teknologi tidak umum, tapi ditagih per pencarian. `false` = taksiran tanpa pencarian |

**Waktu**

| Key | Default | Arti |
| --- | --- | --- |
| `TIMEZONE` | `Asia/Jakarta` | Dipakai untuk resolusi "besok", "sore", dll. |
| `REMINDER_MINUTES_BEFORE` | `30` | Alarm cadangan, dipakai hanya kalau pesan tidak menyebut sendiri. `0` = tepat saat acara mulai. Maks `10080` (7 hari) |

**CalDAV**

| Key | Default | Arti |
| --- | --- | --- |
| `CALDAV_URL` | `http://localhost:5232/` | Di-override oleh Compose |
| `CALDAV_USERNAME` / `CALDAV_PASSWORD` | — | Kredensial Radicale |
| `CALDAV_CALENDAR` | kosong | Nama kalender tujuan; kosong = kalender pertama |

**Lain-lain**

| Key | Default | Arti |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Lokasi `auth/`, `notes.jsonl`, `tasks.jsonl`, dan `media/` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `BAILEYS_LOG_LEVEL` | `warn` | Log internal Baileys, dipisah karena sangat berisik |

## Struktur kode

| File | Isi |
| --- | --- |
| [src/index.ts](src/index.ts) | Entrypoint: verifikasi CalDAV, start Baileys, start penjadwal, shutdown SIGINT/SIGTERM |
| [src/whatsapp.ts](src/whatsapp.ts) | Koneksi Baileys, QR, reconnect, deteksi self-chat, `react()`, `reply()`, `sendText()` |
| [src/handler.ts](src/handler.ts) | Alur: filter → react ⏳ → ekstrak → simpan → react hasil |
| [src/commands.ts](src/commands.ts) | Perintah baca `/list`, `/cari`, `/agenda`, `/bantuan` |
| [src/gemini.ts](src/gemini.ts) | Prompt Bahasa Indonesia, response schema terstruktur, taksiran kesulitan tugas |
| [src/caldav.ts](src/caldav.ts) | Bangun ICS + `PUT` ke Radicale, cache kalender |
| [src/notes.ts](src/notes.ts) | Catatan JSONL append-only |
| [src/tasks.ts](src/tasks.ts) | Penyimpanan tugas + perencanaan lapisan pengingat |
| [src/scheduler.ts](src/scheduler.ts) | Sapuan tiap menit: kirim pengingat yang jatuh tempo, tutup tugas kedaluwarsa |
| [src/media.ts](src/media.ts) | Deteksi foto/video, unduh, simpan ke `data/media/` |
| [src/time.ts](src/time.ts) | Format tanggal Bahasa Indonesia + "sekarang" sesuai `TIMEZONE` |
| [src/config.ts](src/config.ts) | Validasi env dengan zod, pencocokan whitelist 9 digit akhir |
| [src/logger.ts](src/logger.ts) | pino + pino-pretty |

## Data di disk

```
data/
  auth/            sesi WhatsApp — RAHASIA, setara akses penuh ke akunmu
  notes.jsonl      catatan, satu JSON per baris
  tasks.jsonl      tugas + status tiap lapisan pengingat (ditulis ulang saat berubah)
  media/2026-09/   foto & video dari `/simpan`, dikelompokkan per bulan
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
| Pesan tidak diproses sama sekali | Pesan harus berawalan `/catat`, `/ingatkan`, `/note`, `/simpan`, atau `/tugas` (default `REQUIRE_KEYWORD=true`). Cek juga `ALLOW_SELF_CHAT` / `WHITELIST` |
| Foto dikirim tapi berkasnya tidak tersimpan | Keterangannya harus diawali `/simpan`. Kata kunci lain sengaja hanya mencatat teksnya |
| Audio/dokumen/stiker tidak tersimpan | Memang tidak didukung; hanya foto dan video yang diunduh |
| Balasan `⚠️ Lampiran tidak tersimpan` | Berkas melewati `MEDIA_MAX_MB`, atau media lama sudah kedaluwarsa di server WA dan HP tidak bisa reupload |
| Event dibuat tapi tidak muncul di HP | Sync DAVx5 masih menunggu polling; tarik-untuk-refresh atau percepat intervalnya |
| Waktu event ngawur | `TIMEZONE` salah, atau pesannya memang ambigu — cek `LOG_LEVEL=debug` untuk melihat hasil ekstraksi |
| `/tugas` dibalas "belum bisa dijadwalkan" | Tenggatnya tidak punya tanggal (mis. "deadline UTS"). Kirim ulang dengan tanggal/hari yang jelas |
| Pengingat tugas tidak pernah datang | Cek `sudo docker compose logs bot \| grep penjadwal`, lalu `cat data/tasks.jsonl` — kalau `status` sudah `done`, tenggatnya sudah lewat |

Log terstruktur: `docker compose logs -f bot`. Set `LOG_LEVEL=debug` untuk melihat JSON
hasil ekstraksi Gemini per pesan.
