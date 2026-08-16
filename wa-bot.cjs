// wa-bot.cjs
require("dotenv").config();

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { parse } = require("csv-parse/sync");
const Groq = require("groq-sdk");

// ====== ENV & KONFIG ======
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CSV_URL_ENV  = process.env.FASILITAS_CSV_URL || "";
const GROQ_MODEL   = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY belum diset di .env");
  process.exit(1);
}
if (!CSV_URL_ENV) {
  console.warn("⚠️ FASILITAS_CSV_URL belum diset. Perintah 'fasilitas' tidak akan menampilkan data.");
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

// ====== UTIL: normalisasi URL CSV Sheets ======
function normalizeCsvUrl(raw) {
  if (!raw) return "";

  let url = raw.trim();

  // share link: /d/<ID>/edit → export csv
  url = url.replace(/\/edit(\?usp=.*)?$/i, "/export?format=csv");

  // publish html → publish csv
  url = url.replace(/\/pubhtml(\?.*)?$/i, "/pub?output=csv");

  // output=html → output=csv
  url = url.replace(/output=html/i, "output=csv");

  return url;
}

// ====== FETCH CSV dari Sheets ======
async function fetchCsvRows() {
  try {
    const url = normalizeCsvUrl(CSV_URL_ENV);
    if (!url) return [];

    // gunakan global fetch (Node 18+). fallback node-fetch kalau perlu
    const doFetch = typeof fetch === "function" ? fetch : require("node-fetch");

    const res = await doFetch(url, {
      redirect: "follow",
      headers: {
        "Accept": "text/csv, text/plain;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    let text = await res.text();

    // kalau ternyata HTML, fallback ke gviz CSV
    const looksHtml = /^\s*<(!DOCTYPE|html)/i.test(text);
    if (looksHtml) {
      const gviz = url
        .replace(/\/pub\?output=csv.*/i, "/gviz/tq?tqx=out:csv")
        .replace(/\/export\?format=csv.*/i, "/gviz/tq?tqx=out:csv");
      const res2 = await doFetch(gviz, { redirect: "follow" });
      if (!res2.ok) throw new Error(`fallback status ${res2.status}`);
      text = await res2.text();
    }

    // buang BOM & normalisasi newline
    text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

    const rows = parse(text, {
      columns: (hdrs) => hdrs.map((h) => String(h).trim().toLowerCase()),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    const data = rows
      .map((r) => ({
        nama: (r["nama tempat"] || r["nama"] || "").toString().trim(),
        deskripsi: (r["deskripsi"] || "").toString().trim(),
        maps: (r["google maps"] || r["maps"] || "").toString().trim(),
        foto: (r["foto"] || "").toString().trim(),
      }))
      .filter(
        (it) =>
          it.nama &&
          it.nama.toLowerCase() !== "nama tempat" &&
          (it.deskripsi || it.maps || it.foto)
      );

    console.log(`ℹ️ Fasilitas ter-load: ${data.length} entri.`);
    return data;
  } catch (e) {
    console.error("❌ Gagal baca CSV dari Sheets:", e.message);
    return [];
  }
}

// cache di memori
let FASILITAS = [];
(async () => {
  FASILITAS = await fetchCsvRows();
})();

// ====== GROQ: klasifikasi sampah ======
async function klasifikasiSampah(teks) {
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `Kamu adalah asisten edukasi sampah untuk Kampung Semaki Gede.
Jawab SELALU dengan format:
- Jenis: (Organik / Anorganik / B3)
- Cara pengelolaan: (praktis & singkat, sesuai item)
- Penjelasan: (alasan singkat)
Jika input bukan sampah atau tidak jelas, balas:
"Maaf, itu bukan sampah yang bisa saya klasifikasikan."`,
        },
        { role: "user", content: teks },
      ],
      temperature: 0.3,
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "⚠️ Maaf, saya tidak menemukan jawaban."
    );
  } catch (err) {
    return `❌ Terjadi error (GROQ): ${err.message}`;
  }
}

// ====== UI teks ======
const seenWelcome = new Map();

function menuText() {
  return `Halo! 👋
Saya *Chatbot Kampung Semaki Gede*.

Silakan pilih:
1) Edukasi Sampah  – ketik: *sampah <nama benda>*
   contoh: sampah kulit mangga
2) Info Fasilitas – ketik: *fasilitas*
   Lihat daftar tempat (maps & foto)

Perintah lain:
- *menu* untuk melihat menu
- *fasilitas <nomor>* untuk detail + foto
- *refresh fasilitas* untuk reload data dari Google Sheets`;
}

function listFasilitasText(items, limit = 50) {
  if (!items.length) return "Belum ada data fasilitas.";
  const slice = items.slice(0, limit);
  let t = `=== Fasilitas Kampung Semaki Gede ===\n`;
  slice.forEach((f, i) => {
    t += `\n${i + 1}. ${f.nama}\n   Deskripsi: ${f.deskripsi}\n   Maps: ${f.maps}\n`;
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

// ====== WHATSAPP CLIENT ======
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "semaki-gede-bot" }),
  puppeteer: {
    headless: true,
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
    const text = (msg.body || "").trim();
    const lower = text.toLowerCase();

    // Welcome pertama kali
    if (!seenWelcome.get(chatId)) {
      await msg.reply(menuText());
      seenWelcome.set(chatId, true);
      return;
    }

    // Menu
    if (lower === "menu" || lower === "help") {
      await msg.reply(menuText());
      return;
    }

    // Refresh fasilitas
    if (lower === "refresh fasilitas") {
      const data = await fetchCsvRows();
      FASILITAS = data;
      await msg.reply(`🔄 Data fasilitas di-reload. Total: ${FASILITAS.length} entri.`);
      return;
    }

    // Edukasi sampah
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

    // Daftar fasilitas
    if (lower === "fasilitas") {
      const daftar = listFasilitasText(FASILITAS, 50);
      await msg.reply(daftar);
      return;
    }

    // Detail fasilitas
    if (lower.startsWith("fasilitas ")) {
      const no = lower.replace("fasilitas", "").trim();
      const f = fasilitasDetail(no);
      if (!f) {
        await msg.reply("❌ Nomor fasilitas tidak ditemukan. Ketik *fasilitas* untuk lihat daftar.");
        return;
      }

      await msg.reply(
        `*${f.nama}*\n${f.deskripsi}\nMaps: ${f.maps}${f.foto ? `\nFoto: ${f.foto}` : ""}`
      );

      if (f.foto && /^https?:\/\//i.test(f.foto)) {
        try {
          const media = await MessageMedia.fromUrl(f.foto, { unsafeMime: true });
          await client.sendMessage(chatId, media, { caption: f.nama });
        } catch (e) {
          await msg.reply(
            "⚠️ Gagal mengambil foto dari URL. Pastikan link gambar publik (contoh: Google Drive pakai format *uc?export=view&id=...*)."
          );
        }
      }
      return;
    }

    // Fallback
    await msg.reply(
      "Maaf, aku tidak paham.\n" +
        "• Ketik *sampah <benda>* (contoh: *sampah kulit mangga*)\n" +
        "• Ketik *fasilitas* untuk lihat daftar tempat\n" +
        "• Ketik *fasilitas <nomor>* untuk detail & foto\n" +
        "• Ketik *menu* untuk bantuan"
    );
  } catch (err) {
    console.error("Handler error:", err);
    try {
      await msg.reply("❌ Terjadi error. Coba lagi ya.");
    } catch {}
  }
});

client.initialize();