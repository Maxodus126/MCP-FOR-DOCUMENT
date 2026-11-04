# Universal Document Reader MCP Server v3.0

[![CI](https://github.com/Maxodus126/MCP-FOR-DOCUMENT/actions/workflows/ci.yml/badge.svg)](https://github.com/Maxodus126/MCP-FOR-DOCUMENT/actions/workflows/ci.yml)

MCP server lokal berbasis **Node.js 22 LTS, TypeScript, dan SDK resmi `@modelcontextprotocol/sdk`**. Server menyediakan lima tools read-only untuk membaca metadata, mengekstrak teks, dan mencari konten PDF, DOCX, XLSX, serta CSV.

Transport default adalah **STDIO** untuk Claude Desktop, Cursor, dan MCP client yang mendukung STDIO.

> Status release: source v3.0 sudah dilengkapi automated unit tests, setup scripts, doctor, dan protocol smoke test. Namun, full install/build/runtime dari lingkungan pembuat belum dapat diverifikasi karena akses ke `registry.npmjs.org` gagal dengan `EAI_AGAIN`. Jalankan `npm run verify` pada komputer target sebelum dipakai. Jangan menganggap paket siap production hanya karena source berhasil diunduh.

## 1. Fitur

| Tool | Fungsi | Format |
|---|---|---|
| `get_document_info` | Nama, ukuran byte/MB, ekstensi, modified time, total halaman PDF jika metadata parser menyediakannya | PDF, DOCX, XLSX, CSV |
| `read_pdf` | Ekstraksi teks, rentang halaman, truncation, deteksi indikasi scan/kosong | PDF |
| `read_word` | Markdown: heading, daftar, tabel, tautan aman, placeholder gambar | DOCX |
| `read_excel` | Satu sheet ke Markdown/JSON, maxRows, max 50 kolom | XLSX, CSV |
| `search_in_document` | Keyword/frasa dengan ranking sederhana dan lokasi halaman/paragraf/sheet/baris | PDF, DOCX, XLSX, CSV |
| `create_pdf` | Membuat PDF baru dari teks/Markdown di `ALLOWED_OUTPUT_DIRS` | output PDF |
| `create_docx` | Membuat DOCX baru dari Markdown (heading, bullet, paragraf) | output DOCX |
| `create_excel` | Membuat XLSX/CSV baru dari kolom + baris data | output XLSX/CSV |
| `convert_document` | Baca PDF/DOCX/XLSX/CSV lalu tulis versi baru dalam format target | semua → pdf/docx/xlsx/csv |

> **Model keamanan:** tool `create_*` dan `convert_document` **menulis file** — berbeda dari tool baca yang read-only. Wajib konfigurasi `ALLOWED_OUTPUT_DIRS` (default menurun ke `ALLOWED_DIRS`). Hanya basename tanpa path yang diterima, dilarang menimpa kecuali `overwrite:true`, dan ukuran output dibatasi `MAX_FILE_SIZE_MB`. Konversi berbasis teks; layout/format kaya tidak dipertahankan.

DOCX tidak mempunyai nomor halaman stabil karena pagination tergantung aplikasi, font, dan layout. Pencarian DOCX menggunakan urutan paragraf. CSV diperlakukan sebagai satu worksheet. CSV UTF-8 dan UTF-16 dengan BOM didukung. Delimiter koma, titik koma, tab, dan pipe dideteksi otomatis dari baris pertama.

## 2. Perbaikan v3.0

- **Parser child process:** setiap tugas parser dijalankan dalam proses Node terpisah dengan V8 heap limit, timeout, cancellation, dan penghentian paksa jika proses tidak berhenti. Crash parser native lebih terisolasi dari MCP gateway.
- **Bounded concurrency + bounded queue:** mencegah antrean tak terbatas; request yang dibatalkan saat menunggu antrean dilepas.
- **Path allowlist:** absolute path, canonical path, realpath, containment check, file regular, ukuran file, snapshot stat, `O_NOFOLLOW` bila didukung, dan revalidation saat file dibuka.
- **File signature checks:** PDF harus memiliki header `%PDF-`; DOCX/XLSX harus berupa ZIP Office; CSV dicek agar tidak tampak sebagai file biner.
- **ZIP preflight lebih ketat:** validasi central/local header, duplicate/path traversal entry, ZIP64/multi-disk/encryption rejection, symlink entry rejection, actual decompression size, compression ratio aktual, overlap data, dan CRC32.
- **Output controls:** batas output, baris, kolom, halaman, antrean, waktu proses, dan ukuran file.
- **Cancellation:** MCP request `AbortSignal` diteruskan ke antrean dan parser child process.
- **Operational checks:** unit tests, `doctor`, `smoke-test`, dan skrip setup Windows.
- **STDIO discipline:** log diagnostik hanya ke STDERR; STDOUT khusus JSON-RPC MCP.

## 3. Persyaratan

- **Node.js 22 LTS direkomendasikan**; minimum 20.19.0.
- npm 10+.
- Koneksi internet untuk instalasi dependency pertama kali.
- Direktori dokumen yang sudah ada dan ditetapkan melalui `ALLOWED_DIRS`.

Periksa versi:

```powershell
node --version
npm --version
```

## 4. Instalasi Windows (direkomendasikan)

1. Ekstrak ZIP ke lokasi tetap, misalnya `C:\MCP\document-mcp-server-v3`.
2. Buka PowerShell di folder tersebut.
3. Jalankan:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
```

Skrip akan memeriksa versi Node, membuat `.env` jika belum ada, memasang dependency, menjalankan typecheck/unit test/build, dan menjalankan doctor.

Jika ingin manual:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run check
npm run doctor
npm run smoke
```

**Wajib:** edit `ALLOWED_DIRS` pada `.env` sebelum menghubungkan MCP client. Gunakan direktori khusus yang berisi dokumen yang memang boleh dibaca, bukan seluruh drive atau folder profil pengguna.

Contoh `.env` Windows:

```dotenv
ALLOWED_DIRS=C:/Users/NamaAnda/Documents;D:/Shared/Reports
MAX_FILE_SIZE_MB=50
MAX_OUTPUT_CHARS=100000
MAX_CONCURRENT_TOOLS=1
MAX_QUEUED_TOOLS=16
MAX_QUEUE_WAIT_MS=30000
MAX_PROCESSING_TIMEOUT_MS=60000
WORKER_OLD_SPACE_MB=384
WORKER_SEMI_SPACE_MB=16
MAX_ZIP_EXPANDED_MB=100
MAX_ZIP_ENTRIES=2000
MAX_ZIP_COMPRESSION_RATIO=100
MAX_EXCEL_SCAN_ROWS=20000
MAX_EXCEL_SCAN_COLUMNS=50
MAX_PDF_PAGES=1000
```

Default `MAX_CONCURRENT_TOOLS=1` dipilih untuk mengurangi tekanan RAM. Naikkan ke 2 hanya setelah load test menunjukkan headroom memadai.

### Linux/macOS

```bash
cp .env.example .env
```

Gunakan `:` sebagai pemisah `ALLOWED_DIRS`, misalnya:

```dotenv
ALLOWED_DIRS=/home/anda/Documents:/mnt/shared/reports
```

## 5. Perintah pemeriksaan dan operasi

```bash
npm run typecheck
npm test
npm run build
npm run doctor
npm run smoke
```

Atau jalankan semua pemeriksaan berurutan:

```bash
npm run verify
```

Jalankan server hasil build:

```bash
npm run start:prod
```

Server STDIO tidak membuka HTTP port. Jangan menjalankan `npm start` sebagai layanan production; gunakan hasil build melalui `npm run start:prod` atau konfigurasi MCP client.

### Arti pemeriksaan

- `typecheck`: memeriksa tipe TypeScript.
- `test`: unit test path security, ZIP preflight, signature, sanitasi, truncation, dan antrean cancellation.
- `build`: menghasilkan `dist/`.
- `doctor`: memeriksa Node, dependency, build, dan allowlist.
- `smoke`: menjalankan proses server sungguhan, melakukan MCP initialize, tools/list, lalu memanggil metadata, CSV read, dan search.

Smoke test tidak menggantikan pengujian PDF/DOCX/XLSX dengan dokumen nyata. Lakukan pengujian manual yang dijelaskan pada bagian 11.

## 6. Konfigurasi Claude Desktop (Windows)

Build terlebih dahulu (`npm run build`). Buka konfigurasi Claude Desktop yang umumnya berada di:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Tambahkan entri ini. Jika sudah ada `mcpServers`, gabungkan object servernya; jangan menimpa konfigurasi server lain.

```json
{
  "mcpServers": {
    "universal-document-reader": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\MCP\\document-mcp-server-v3\\dist\\index.js"
      ],
      "env": {
        "ALLOWED_DIRS": "C:\\Users\\NamaAnda\\Documents;D:\\Shared\\Reports",
        "MAX_FILE_SIZE_MB": "50",
        "MAX_OUTPUT_CHARS": "100000",
        "MAX_CONCURRENT_TOOLS": "1",
        "MAX_QUEUED_TOOLS": "16",
        "MAX_QUEUE_WAIT_MS": "30000",
        "MAX_PROCESSING_TIMEOUT_MS": "60000",
        "WORKER_OLD_SPACE_MB": "384",
        "WORKER_SEMI_SPACE_MB": "16",
        "MAX_ZIP_EXPANDED_MB": "100",
        "MAX_ZIP_ENTRIES": "2000",
        "MAX_ZIP_COMPRESSION_RATIO": "100",
        "MAX_EXCEL_SCAN_ROWS": "20000",
        "MAX_EXCEL_SCAN_COLUMNS": "50",
        "MAX_PDF_PAGES": "1000"
      }
    }
  }
}
```

Ganti path `node.exe`, `dist/index.js`, dan direktori allowlist dengan lokasi aktual. `ALLOWED_DIRS` di konfigurasi client akan mengungguli nilai `.env` karena dotenv menggunakan `override: false`.

Restart Claude Desktop. Jika server tidak muncul, lihat bagian troubleshooting dan log Claude Desktop.

## 7. Konfigurasi Cursor

Untuk project-local MCP, buat/edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "universal-document-reader": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/MCP/document-mcp-server-v3/dist/index.js"],
      "env": {
        "ALLOWED_DIRS": "C:/Users/NamaAnda/Documents",
        "MAX_FILE_SIZE_MB": "50",
        "MAX_OUTPUT_CHARS": "100000",
        "MAX_CONCURRENT_TOOLS": "1",
        "MAX_QUEUED_TOOLS": "16",
        "MAX_QUEUE_WAIT_MS": "30000",
        "MAX_PROCESSING_TIMEOUT_MS": "60000",
        "WORKER_OLD_SPACE_MB": "384",
        "WORKER_SEMI_SPACE_MB": "16",
        "MAX_ZIP_EXPANDED_MB": "100",
        "MAX_ZIP_ENTRIES": "2000",
        "MAX_ZIP_COMPRESSION_RATIO": "100",
        "MAX_EXCEL_SCAN_ROWS": "20000",
        "MAX_EXCEL_SCAN_COLUMNS": "50",
        "MAX_PDF_PAGES": "1000"
      }
    }
  }
}
```

Restart/reload MCP server dari Cursor setelah menyimpan.

## 8. Tool schemas dan contoh pemanggilan

### `get_document_info`

```json
{ "filePath": "C:/Users/NamaAnda/Documents/laporan.pdf" }
```

Untuk PDF, `totalPages` bisa `null` jika metadata parser tidak dapat menentukan jumlah halaman. Tool ini tidak mengekstrak seluruh teks sebagai fallback.

### `read_pdf`

```json
{
  "filePath": "C:/Users/NamaAnda/Documents/laporan.pdf",
  "startPage": 4,
  "endPage": 8,
  "maxChars": 50000
}
```

- `startPage` default 1.
- `endPage` opsional; tanpa nilai berarti sampai halaman terakhir.
- `maxChars` default 100.000 dan dibatasi konfigurasi `MAX_OUTPUT_CHARS`.
- PDF scan/gambar akan diberi peringatan; OCR belum disertakan.
- **Penting:** server meminta `pdf-parse` mengekstrak halaman yang dipilih melalui parameter `partial`. Parser tetap perlu membaca struktur PDF dan dapat memiliki overhead internal; ini bukan jaminan I/O fisik hanya membaca byte halaman tersebut. Timeout, child-process V8 heap limit, dan batas halaman membatasi dampaknya.
- PDF dengan halaman lebih dari `MAX_PDF_PAGES` ditolak pada ekstraksi.

### `read_word`

```json
{
  "filePath": "C:/Users/NamaAnda/Documents/laporan.docx",
  "maxChars": 50000
}
```

Mengubah DOCX ke Markdown. Tabel dan heading dikonversi sejauh didukung Mammoth. Gambar menjadi placeholder. Nomor halaman tidak disediakan.

### `read_excel`

```json
{
  "filePath": "C:/Users/NamaAnda/Documents/data.xlsx",
  "sheetName": "Sheet1",
  "maxRows": 100,
  "outputFormat": "json"
}
```

- Format: `markdown` atau `json`.
- `sheetName` opsional; default sheet pertama.
- `maxRows` default 100, maksimum 5.000 baris yang dikembalikan.
- Maksimum 50 kolom yang dikembalikan. Jika hasil Markdown/JSON melampaui batas karakter server, jumlah baris otomatis dikurangi dan status `truncated` diberi tanda.
- Formula tidak dihitung ulang; nilai cached dipakai bila tersedia. Jika tidak, formula dikembalikan sebagai teks.
- ExcelJS memuat workbook ke memori proses parser; batas output tidak sama dengan batas memori internal. Gunakan file yang wajar dan atur V8 heap/timeout.

### `search_in_document`

```json
{
  "filePath": "C:/Users/NamaAnda/Documents/laporan.pdf",
  "query": "metode penelitian",
  "maxResults": 5
}
```

Pencarian tidak case-sensitive dan menormalkan Unicode. Untuk query multi-kata, semua istilah harus muncul dalam satu unit (halaman/paragraf/baris). Frasa persis diberi skor lebih tinggi. Batas scanning Excel diatur oleh `MAX_EXCEL_SCAN_ROWS` dan `MAX_EXCEL_SCAN_COLUMNS`.

### Tool tulis & konversi (skema singkat)

- `create_pdf { fileName, text, overwrite? }` — `fileName` basename `.pdf` di `ALLOWED_OUTPUT_DIRS`.
- `create_docx { fileName, markdown, overwrite? }` — Markdown disederhanakan: `#`/`##` heading, `-` bullet, paragraf.
- `create_excel { fileName, sheetName?, columns, rows, overwrite? }` — maks 50 kolom, 5.000 baris; `.xlsx` atau `.csv`.
- `convert_document { sourcePath, fileName, targetFormat, sheetName?, overwrite? }` — `targetFormat` ∈ `pdf|docx|xlsx|csv`. Sumber harus di `ALLOWED_DIRS`; output di `ALLOWED_OUTPUT_DIRS`.

Batas tambahan: `MAX_INPUT_CHARS` (default 100.000, maks 250.000) untuk teks/Markdown input. Lihat `.env.example`.

## 9. Error handling

Semua error tool dikembalikan sebagai MCP tool result dengan `isError: true` dan teks berkode, bukan stack trace internal.

| Kode | Penyebab umum | Tindakan |
|---|---|---|
| `INVALID_PATH` | Path relatif/kosong/null byte | Gunakan absolute path |
| `PATH_OUTSIDE_ALLOWLIST` | File di luar `ALLOWED_DIRS` | Pindahkan/copy file ke folder yang diizinkan |
| `FILE_NOT_FOUND` | Salah nama/path | Periksa path dan ekstensi |
| `FILE_TOO_LARGE` | Lebih dari 50 MB/config | Kompres atau pecah dokumen |
| `FILE_SIGNATURE_MISMATCH` | Ekstensi tidak sesuai isi file | Pastikan format file benar |
| `PDF_PAGE_LIMIT` | PDF melebihi batas halaman | Turunkan ukuran dokumen/naikkan batas secara sadar |
| `PAGE_MAPPING_UNAVAILABLE` | Parser tidak dapat memetakan teks ke halaman | Baca seluruh teks yang tersedia tanpa rentang |
| `OFFICE_EXPANSION_LIMIT` | Ukuran dekompresi melebihi batas | File ditolak; jangan menonaktifkan guard |
| `PROCESSING_TIMEOUT` | Parser terlalu lama | Kurangi ukuran/rentang atau cek file rusak |
| `PDF_PARSE_FAILED` / `DOCX_PARSE_FAILED` / `SPREADSHEET_PARSE_FAILED` | File rusak atau format tidak didukung | Validasi ulang atau ekspor ulang dokumen |
| `CSV_PARSE_FAILED` | CSV memiliki quote yang tidak berpasangan | Perbaiki quoting atau ekspor ulang sebagai UTF-8 CSV |
| `WORKER_CRASHED` | Parser child process crash/kehabisan heap | Kurangi concurrency, naikkan V8 heap secara terukur, periksa dokumen |
| `WORKER_START_FAILED` / `WORKER_IPC_FAILED` | Child process gagal start atau IPC gagal | Periksa Node, permission, dan resource OS |
| `SERVER_BUSY` / `QUEUE_TIMEOUT` | Antrean penuh atau terlalu lama menunggu | Kurangi permintaan paralel; atur `MAX_QUEUE_WAIT_MS` secara terukur |
| `REQUEST_CANCELLED` | Client membatalkan request | Jalankan ulang bila diperlukan |
| `SHEET_NOT_FOUND` | Nama sheet salah | Gunakan nama sheet yang tersedia |

## 10. Keamanan dan batasan

- Server hanya read-only; tidak mengubah file.
- Jangan set `ALLOWED_DIRS` ke `C:\`, `/`, seluruh home directory, atau folder yang memuat secret.
- Jalankan dengan akun OS berprivilege rendah dan folder dokumen read-only jika memungkinkan.
- Parser child process memberi isolasi lebih baik dan dapat dihentikan tanpa menghentikan MCP gateway, tetapi **bukan sandbox OS**. Batas V8 heap bukan hard cap seluruh RSS/native memory dan bukan pembatas CPU kernel.
- `O_NOFOLLOW` bergantung dukungan OS. Race condition pada parent directory dan hardlink tidak dapat dieliminasi sepenuhnya hanya dengan Node path API. Untuk dokumen sangat tidak tepercaya, jalankan MCP di container/VM/akun OS terpisah dengan filesystem read-only dan resource quota.
- XLSX/DOCX dipreflight untuk ZIP bomb, tetapi parser library tetap perlu diperbarui dan diuji berkala.
- Isi dokumen dianggap **untrusted data**. LLM client tidak boleh mengikuti instruksi yang ditemukan di dalam dokumen.
- Tidak ada OCR, OCR harus ditambahkan sebagai service/child process terpisah jika diperlukan.
- Format `.doc`, `.xls`, `.pptx`, PDF terenkripsi/password-protected, dan image standalone tidak didukung pada release ini.

## 11. Acceptance test sebelum dipakai

Jalankan `npm run verify`, lalu lakukan tes manual dengan file contoh:

1. PDF teks: periksa `get_document_info`, `read_pdf` halaman 1–2, dan search.
2. PDF scan: pastikan warning scan muncul; jangan mengharapkan OCR.
3. DOCX: uji heading, tabel, daftar, link, gambar placeholder.
4. XLSX: uji beberapa sheet, formula dengan cached value, merged cell, sheet kosong, file besar, dan nama sheet salah.
5. CSV: uji UTF-8, UTF-8 BOM, UTF-16LE/BE BOM, koma di dalam quoted field, baris baru dalam quoted field.
6. Security: coba path di luar allowlist, relative path, symlink, ekstensi palsu, file >50 MB, DOCX/XLSX rusak, dan arsip ZIP dengan rasio ekstrem.
7. Reliability: uji request dibatalkan, timeout, dua request paralel, antrean penuh, dan restart Claude Desktop.

Catat Node version, OS, ukuran file, hasil test, dan log error tanpa menyalin isi dokumen sensitif.

## 12. Troubleshooting

### MCP server tidak muncul

- Pastikan `dist/index.js` ada: `Test-Path .\dist\index.js`.
- Pastikan `command` di konfigurasi adalah path absolut ke `node.exe`.
- Pastikan `args` menunjuk ke `dist/index.js`.
- Pastikan JSON valid dan tidak ada trailing comma.
- Restart Claude Desktop/Cursor sepenuhnya.
- Jalankan `npm run doctor` dan `npm run smoke` dari terminal.

### `ALLOWED_DIRS` invalid

- Folder harus sudah dibuat.
- Gunakan absolute path.
- Windows pisahkan beberapa folder dengan `;`, Linux/macOS dengan `:`.
- Path dalam konfigurasi JSON harus di-escape (`\\`) atau gunakan `/` jika diterima aplikasi.

### `Cannot find package` / module not found

- Jalankan `npm install` di folder proyek.
- Jangan memindahkan `dist/` keluar dari folder proyek tanpa dependency yang sesuai.
- Gunakan Node 22 LTS.

### `EAI_AGAIN`, `ECONNRESET`, atau registry timeout

- Ini masalah DNS/jaringan/proxy ke npm registry, bukan error TypeScript.
- Periksa koneksi, VPN, proxy kantor, DNS, dan `npm config get registry`.
- Ulangi `npm install` setelah jaringan pulih. Jangan mengganti dependency dengan paket tidak resmi.

### `PROCESSING_TIMEOUT` atau `WORKER_CRASHED`

- Uji file yang lebih kecil.
- Set `MAX_CONCURRENT_TOOLS=1`.
- Periksa RAM tersedia.
- Naikkan `WORKER_OLD_SPACE_MB` secara bertahap (mis. 512) hanya jika RAM memadai.
- Jangan menaikkan `MAX_FILE_SIZE_MB` di atas 50; batas tersebut dikunci di aplikasi.

### Claude tidak mewarisi `.env`

Server membaca `.env` relatif terhadap folder proyek. Untuk Claude Desktop, cara paling deterministik adalah memasukkan `ALLOWED_DIRS` dan batas penting di object `env` konfigurasi MCP.

## 13. Reproducible install

Setelah instalasi pertama berhasil, simpan `package-lock.json` yang dihasilkan npm ke repository. Untuk mesin deployment berikutnya gunakan:

```bash
npm ci
npm run verify
```

Jangan menghapus atau mengubah versi dependency tanpa menjalankan kembali seluruh test dan acceptance test.
