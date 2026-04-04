const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook erstellen
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Schon gesendete Items speichern, um doppelte Benachrichtigungen zu vermeiden
let seen = {};

// --- Funktionen ---

// Vinted API abrufen
async function fetchVinted(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    console.log(`[DEBUG] Items von API erhalten: ${res.data.items?.length || 0}`);
    return res.data.items || [];
  } catch (err) {
    console.error("Fehler beim Abrufen von Vinted API:", err.message);
    return [];
  }
}

// Items filtern nach Suchkriterien
function parseVinted(items, search) {
  const results = [];

  for (const it of items) {
    const title = it.title || "–";
    const url = it.url || `https://www.vinted.de/items/${it.id}`;
    const price = it.price?.amount || "–";
    const thumb = it.photos?.[0]?.url_full || null;

    const txt = (title + " " + (it.description || "")).toLowerCase();

    const brandOk = txt.includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || (price !== "–" && price <= search.max_price);

    if (brandOk && priceOk) {
      results.push({ title, url, price, thumb });
    }
  }

  return results;
}

// Embed an Discord senden
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
    console.error("[FEHLER] Discord Webhook:", err.message);
  }
}

// Items prüfen und ggf. senden
async function checkSearch(search) {
  const items = await fetchVinted(search.query_url);
  if (!items.length) {
    console.log(`[INFO] Keine Items gefunden für Suche: "${search.name}"`);
    return;
  }

  const filtered = parseVinted(items, search);
  console.log(`[INFO] ${filtered.length} Items gefunden für Suche: "${search.name}"`);

  for (const item of filtered) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      await sendDiscord(item, search.name);
    }
  }
}

// --- MAIN ---
async function main() {
  console.log("Sniper Vinted gestartet, alle", config.check_interval_seconds, "Sekunden.");

  // Test Webhook beim Start
  try {
    await webhook.send("✅ Vinted-Sniper ist online und Webhook funktioniert!");
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
