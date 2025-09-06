// wa-bot.cjs
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const Groq = require("groq-sdk").default;

// ====== KONFIGURASI ======
const GROQ_API_KEY = process.env.GROQ_API_KEY || "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"; // <- boleh ganti ke .env
const CSV_PATH = path.join(__dirname, "semaki.csv"); // pastikan nama file sama
const GROQ_MODEL = "llama-3.1-8b-instant"; // model yang stabil di Groq

const groq = new Groq({ apiKey: GROQ_API_KEY });

// ====== BACA CSV FASILITAS ======
function loadFasilitas() {
  try {
    const raw = fs.readFileSync(CSV_PATH, "utf8");
    // normalize CSV
    const records = parse(raw, {
      columns: (hdrs) => hdrs.map(h => String(h).trim().toLowerCase()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });

    // map ke field konsisten
    const data = records
      .map(r => ({
        nama: r["nama"] || r["nama tempat"] || "-",
        deskripsi: r["deskripsi"] || "-",
        maps: r["maps"] || r["google maps"] || "-",
        foto: r["foto"] || ""
      }))
      .filter(row => row.nama && row.nama !== "-" && row.deskripsi && row.maps);

    return data;
  } catch (e) {
    console.error("❌ Gagal baca CSV:", e.message);
    return [];
  }
}

let FASILITAS = loadFasilitas();

// ====== FUNGI KLASIFIKASI SAMPAH (GROQ) ======
async function klasifikasiSampah(teks) {
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
`Kamu adalah asisten edukasi sampah untuk Kampung Semaki Gede.
Jawab SELALU dengan format:
- Jenis: (Organik / Anorganik / B3)
- Cara pengelolaan: (praktis & singkat, sesuai item)
- Penjelasan: (alasan singkat)

Jika input bukan sampah atau tidak jelas, balas:
"Maaf, itu bukan sampah yang bisa saya klasifikasikan."`
        },
        { role: "user", content: teks }
      ],
      temperature: 0.3
    });

    return completion.choices?.[0]?.message?.content?.trim() || "⚠️ Maaf, saya tidak menemukan jawaban.";
  } catch (err) {
    return `❌ Terjadi error (GROQ): ${err.message}`;
  }
}

// ====== UTIL: MENU & BALASAN ======
const seenWelcome = new Map(); // ingatkan salam awal per chat

function menuText() {
  return (
`Halo! 👋
Saya *Chatbot Kampung Semaki Gede*.

Silakan pilih:
1) Edukasi Sampah  – ketik: *sampah <nama benda>*
   contoh: sampah kulit mangga
2) Info Fasilitas – ketik: *fasilitas*
   Lihat daftar tempat (maps & foto)

Perintah lain:
- *menu* untuk melihat menu
- *fasilitas <nomor>* untuk detail + foto
- *refresh fasilitas* untuk reload file CSV`
  );
}

function listFasilitasText(items, limit=10) {
  if (!items.length) return "Belum ada data fasilitas.";
  const slice = items.slice(0, limit);
  let t = `=== Fasilitas Kampung Semaki Gede ===\n`;
  slice.forEach((f, i) => {
    t += `\n${i+1}. ${f.nama}\n   Deskripsi: ${f.deskripsi}\n   Maps: ${f.maps}\n`;
  });
  if (items.length > limit) t += `\n(+${items.length - limit} lainnya)\n`;
  t += `\nKetik *fasilitas <nomor>* untuk detail (kirim foto & link).`;
  return t;
}

function fasilitasDetail(idx) {
  const i = Number(idx) - 1;
  if (Number.isNaN(i) || i < 0 || i >= FASILITAS.length) return null;
  return FASILITAS[i];
}

// ====== SETUP WHATSAPP CLIENT ======
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "semaki-gede-bot" }),
  puppeteer: {
    headless: true, // kalau mau lihat browser: false
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("🔐 Scan QR ini dengan WhatsApp nomor bot (disarankan WA Business):");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Bot WhatsApp siap!");
});

client.on("message", async (msg) => {
  try {
    const chatId = msg.from;

    // Kirim welcome pertama kali
    if (!seenWelcome.get(chatId)) {
      await msg.reply(menuText());
      seenWelcome.set(chatId, true);
      return;
    }

    const text = (msg.body || "").trim();
    const lower = text.toLowerCase();

    // Perintah menu
    if (lower === "menu" || lower === "help") {
      await msg.reply(menuText());
      return;
    }

    // Refresh CSV fasilitas (kalau kamu update file)
    if (lower === "refresh fasilitas") {
      FASILITAS = loadFasilitas();
      await msg.reply(`🔄 Data fasilitas di-reload. Total: ${FASILITAS.length} entri.`);
      return;
    }

    // Edukasi sampah: "sampah <teks>"
    if (lower.startsWith("sampah ")) {
      const item = text.slice(7).trim();
      if (!item) {
        await msg.reply("Tolong tulis seperti ini ya: *sampah kulit mangga*");
        return;
      }
      const jawaban = await klasifikasiSampah(item);
      await msg.reply(jawaban);
      return;
    }

    // Daftar fasilitas: "fasilitas"
    if (lower === "fasilitas") {
      const daftar = listFasilitasText(FASILITAS, 20);
      await msg.reply(daftar);
      return;
    }

    // Detail fasilitas: "fasilitas <nomor>"
    if (lower.startsWith("fasilitas ")) {
      const no = lower.replace("fasilitas", "").trim();
      const f = fasilitasDetail(no);
      if (!f) {
        await msg.reply("❌ Nomor fasilitas tidak ditemukan. Ketik *fasilitas* untuk lihat daftar.");
        return;
      }

      // kirim teks detail
      await msg.reply(
        `*${f.nama}*\n${f.deskripsi}\nMaps: ${f.maps}${f.foto ? `\nFoto: ${f.foto}` : ""}`
      );

      // kirim foto kalau URL valid
      if (f.foto && /^https?:\/\//i.test(f.foto)) {
        try {
          const media = await MessageMedia.fromUrl(f.foto, { unsafeMime: true });
          await client.sendMessage(chatId, media, { caption: f.nama });
        } catch (e) {
          await msg.reply("⚠️ Gagal mengambil foto dari URL. Pastikan link gambar publik (contoh: Google Drive pakai format *uc?export=view&id=...*).");
        }
      }
      return;
    }

    // fallback: bantu user
    await msg.reply(
      "Maaf, aku tidak paham.\n" +
      "• Ketik *sampah <benda>* (contoh: *sampah kulit mangga*)\n" +
      "• Ketik *fasilitas* untuk lihat daftar tempat\n" +
      "• Ketik *fasilitas <nomor>* untuk detail & foto\n" +
      "• Ketik *menu* untuk bantuan"
    );

  } catch (err) {
    console.error("Handler error:", err);
    try { await msg.reply("❌ Terjadi error. Coba lagi ya."); } catch {}
  }
});

client.initialize();