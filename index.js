const puppeteer = require("puppeteer-core");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
const webhook = new WebhookClient({ url: config.discord_webhook });

// Gespeicherte Items
let seen = {};

// --- Funktionen ---

// Vinted HTML abrufen
async function fetchVinted(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    return data;
  } catch (err) {
    console.error("❌ Fehler beim Abrufen von Vinted:", err.message);
    return null;
  }
}

// Items parsen
function parseVinted(html, search) {
  const $ = cheerio.load(html);
  const items = [];

  $("div.feed-grid__item").each((i, el) => {
    const title = $(el).find("a.item-card__title").text().trim();
    const url = "https://www.vinted.at" + $(el).find("a.item-card__title").attr("href");
    const price = $(el).find("span[itemprop='price']").text().replace("€", "").trim();
    const thumb = $(el).find("img[itemprop='image']").attr("src");

    const txt = title.toLowerCase();
    const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || (price && parseFloat(price) <= search.max_price);

    if (brandOk && priceOk) {
      items.push({ title, url, price, thumb });
    }
  });

  return items;
}

// Discord Embed senden
async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        { name: "Preis", value: item.price ? item.price + " €" : "–", inline: true },
        { name: "Suche", value: searchName || "–", inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    if (item.thumb) embed.setImage(item.thumb);

    await webhook.send({ embeds: [embed] });
    console.log("[OK] Embed gesendet:", item.title);
  } catch (err) {
    console.error("[Fehler] Discord Webhook:", err.message);
  }
}

// Items prüfen
async function checkSearch(search) {
  const html = await fetchVinted(search.query_url);
  if (!html) return;

  const items = parseVinted(html, search);
  console.log(`[INFO] ${items.length} Items gefunden für Suche: "${search.name}"`);

  for (const item of items) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      await sendDiscord(item, search.name);
    }
  }
}

// --- MAIN ---
async function main() {
  console.log(`🚀 Vinted Sniper läuft alle ${config.check_interval_seconds} Sekunden`);

  // Test Webhook
  try {
    await webhook.send("✅ Vinted-Sniper ist online!");
    console.log("[INFO] Webhook-Test erfolgreich!");
  } catch (err) {
    console.error("[FEHLER] Webhook-Test fehlgeschlagen:", err.message);
  }

  // Intervall
  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();
