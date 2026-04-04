const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Discord Webhook
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Gesendete Items merken, um doppelte Benachrichtigungen zu vermeiden
let seen = {};

// --- Funktionen ---

// Vinted API abfragen
async function fetchVinted(search) {
  try {
    const url = `https://www.vinted.at/api/v2/catalog/items?search_text=${encodeURIComponent(
      search.query
    )}&currency=EUR&per_page=20`;

    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    return res.data.items || [];
  } catch (err) {
    console.error("❌ Fehler beim Abrufen von Vinted API:", err.message);
    return [];
  }
}

// Item an Discord senden
async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(`https://www.vinted.at/items/${item.id}`)
      .addFields(
        { name: "Preis", value: item.price.amount + " " + item.price.currency, inline: true },
        { name: "Suche", value: searchName, inline: true }
      )
      .setTimestamp()
      .setColor(0x00ff00);

    if (item.photos && item.photos[0]) {
      embed.setImage(item.photos[0].url_full);
    }

    await webhook.send({ embeds: [embed] });
    console.log("[OK] Embed gesendet:", item.title);
  } catch (err) {
    console.error("[Fehler] Discord Webhook:", err.message);
  }
}

// Suche prüfen und Items senden
async function checkSearch(search) {
  const items = await fetchVinted(search);

  console.log(`[INFO] ${items.length} Items gefunden für Suche: "${search.name}"`);

  for (const item of items) {
    // Filter: optional nach Marke oder Max-Preis
    const brandOk = !search.brand || item.brand?.title?.toLowerCase().includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || item.price.amount <= search.max_price;

    if (!seen[item.id] && brandOk && priceOk) {
      seen[item.id] = true;
      await sendDiscord(item, search.name);
    }
  }
}

// --- MAIN ---
async function main() {
  console.log(`🚀 Vinted Sniper läuft alle ${config.check_interval_seconds} Sekunden`);

  // Test Webhook beim Start
  try {
    await webhook.send("✅ Vinted-Sniper ist online und Webhook funktioniert!");
    console.log("[INFO] Webhook-Test erfolgreich!");
  } catch (err) {
    console.error("[FEHLER] Webhook-Test fehlgeschlagen:", err.message);
  }

  // Intervall starten
  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();
