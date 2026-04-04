// index.js
const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// --- Config einlesen ---
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// --- Discord Webhook erstellen ---
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// --- Objekt für bereits gesendete Items ---
let seen = {};

// --- Funktionen ---

// HTML/API von Vinted/Nike abrufen
async function fetchItems(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    return res.data;
  } catch (err) {
    console.error("Fehler beim Abrufen der API:", err.message);
    return null;
  }
}

// Items aus API parsen
function parseItems(data, search) {
  const items = [];

  if (!data || !data.products) return items;

  for (const it of data.products) {
    const title = it.title || "–";
    const url = it.url || "–";
    const price = it.price?.current?.value || "–";
    const thumb = it.media?.images?.[0]?.url || null;

    const txt = (title + " " + (it.description || "")).toLowerCase();

    const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || (price !== "–" && price <= search.max_price);

    if (brandOk && priceOk) {
      items.push({ title, url, price, thumb });
    }
  }

  return items;
}

// Discord Embed senden
async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        { name: "Preis", value: item.price !== "–" ? item.price + " €" : "–", inline: true },
        { name: "Suche", value: searchName || "–", inline: true }
      )
      .setTimestamp()
      .setColor(0x00ff00);

    if (item.thumb) embed.setImage(item.thumb);

    await webhook.send({ embeds: [embed] });
    console.log("[OK] Embed gesendet:", item.title);
  } catch (err) {
    console.error("[Fehler] Discord Webhook:", err.message);
  }
}

// Prüfe Items für eine Suche
async function checkSearch(search) {
  const data = await fetchItems(search.query_url);
  if (!data) return;

  const items = parseItems(data, search);
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
  console.log("Sniper läuft alle", config.check_interval_seconds, "Sekunden.");

  // Test Webhook
  try {
    await webhook.send("✅ Sniper ist online und Webhook funktioniert!");
    console.log("[INFO] Webhook-Test erfolgreich!");
  } catch (err) {
    console.error("[FEHLER] Webhook-Test fehlgeschlagen:", err.message);
  }

  // Interval starten
  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();
