#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs");
const readline = require("readline");
const { parse } = require("csv-parse/sync");
const Groq = require("groq-sdk");

// === CONFIG ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY belum diset di .env");
  process.exit(1);
}

const client = new Groq({ apiKey: GROQ_API_KEY });
const fasilitasCSV = "./semaki.csv";

// === Fungsi baca CSV ===
function loadCSV(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");

    const records = parse(fileContent, {
      columns: ["Nama", "Deskripsi", "Maps", "Foto"],
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });

    return records.filter(r => r.Nama && r.Deskripsi && r.Maps);
  } catch (err) {
    console.error("❌ Gagal baca CSV fasilitas:", err.message);
    return [];
  }
}

// === Fungsi tampil fasilitas ===
function tampilkanFasilitas() {
  const fasilitas = loadCSV(fasilitasCSV);

  if (fasilitas.length === 0) {
    console.log("Belum ada data fasilitas.");
    return;
  }

  console.log("\n=== Fasilitas Kampung Semaki Gede ===\n");
  fasilitas.forEach((f, i) => {
    console.log(`${i + 1}. ${f.Nama}`);
    console.log(`   Deskripsi : ${f.Deskripsi}`);
    console.log(`   Maps      : ${f.Maps}`);
    console.log(`   Foto      : ${f.Foto || "-"}`);
    console.log();
  });
}

// === Fungsi edukasi sampah pakai GROQ ===
async function edukasiSampah(pertanyaan) {
  try {
    const response = await client.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        { role: "system", content: "Kamu adalah asisten edukasi tentang sampah dan lingkungan di Kampung Semaki Gede. Jawablah singkat dan jelas." },
        { role: "user", content: pertanyaan }
      ],
    });
    console.log("\n💡 " + response.choices[0].message.content + "\n");
  } catch (err) {
    console.error("❌ Gagal menjawab:", err.message);
  }
}

// === Interface CLI ===
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("🤖 Chatbot Semaki Gede siap! Ketik 'exit' untuk keluar.\n");

function menuUtama() {
  console.log("Silakan pilih topik:");
  console.log("1. Edukasi Sampah");
  console.log("2. Info Fasilitas Kampung Semaki Gede");
  console.log("Ketik 'exit' untuk keluar.");

  rl.question("Pilih (1/2): ", async (jawaban) => {
    if (jawaban === "1") {
      rl.question("\nTanya tentang sampah: ", async (q) => {
        await edukasiSampah(q);
        menuUtama();
      });
    } else if (jawaban === "2") {
      tampilkanFasilitas();
      rl.question("Ketik 'back' untuk kembali: ", () => {
        menuUtama();
      });
    } else if (jawaban.toLowerCase() === "exit") {
      console.log("👋 Terima kasih sudah menggunakan Chatbot Semaki Gede!");
      rl.close();
    } else {
      console.log("❌ Pilihan tidak valid.\n");
      menuUtama();
    }
  });
}

menuUtama();