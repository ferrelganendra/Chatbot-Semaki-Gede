# Chatbot Semaki Gede

Chatbot edukasi sampah dan informasi fasilitas Kampung Semaki Gede.

Project ini berisi dua mode:

- `chatbot.cjs`: chatbot CLI untuk edukasi sampah dan daftar fasilitas dari `semaki.csv`.
- `wa-bot.cjs`: chatbot WhatsApp dengan Groq API dan data fasilitas dari Google Sheets.

## Requirements

- Node.js 18+
- Groq API key
- WhatsApp Web untuk mode WhatsApp
- Google Sheets yang bisa diakses publik untuk data fasilitas mode WhatsApp

## Setup

```bash
npm install
cp .env.example .env
```

Isi `.env`:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-8b-instant
FASILITAS_CSV_URL=https://docs.google.com/spreadsheets/d/your-sheet-id/edit
```

`FASILITAS_CSV_URL` hanya diperlukan oleh mode WhatsApp. File `.env` tidak boleh di-commit.

## Menjalankan

CLI:

```bash
node chatbot.cjs
```

WhatsApp:

```bash
node wa-bot.cjs
```

Saat pertama kali menjalankan mode WhatsApp, scan QR yang muncul di terminal. Sesi WhatsApp tersimpan di `.wwebjs_auth/`.

## Perintah WhatsApp

| Perintah | Fungsi |
| --- | --- |
| `menu` | Menampilkan menu |
| `sampah <nama benda>` | Mengklasifikasikan sampah dengan Groq |
| `fasilitas` | Menampilkan daftar fasilitas |
| `fasilitas <nomor>` | Menampilkan detail fasilitas dan foto |
| `refresh fasilitas` | Memuat ulang data dari Google Sheets |

## Struktur Data

CSV fasilitas memakai kolom:

```text
Nama Tempat,Deskripsi,Google Maps,Foto
```

## Catatan Keamanan

- API key dibaca dari `GROQ_API_KEY`, bukan dari source code.
- `.env`, `node_modules/`, dan `.wwebjs_auth/` sudah masuk `.gitignore`.
- Jika API key pernah terlanjur dipublikasikan, revoke key tersebut di Groq Console lalu buat key baru.

## Status

Project ini merupakan project lama dan tidak sedang dijalankan sebagai layanan aktif.