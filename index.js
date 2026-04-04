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

// HTML von Vinted abrufen
async function fetchVinted(search) {
  try {
    const url = `https://www.vinted.at/catalog?search_text=${encodeURIComponent(search.query)}`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    return res.data;
  } catch (err) {
    console.error("❌ Fehler beim Abrufen von Vinted:", err.message);
    return null;
  }
}

// Items aus HTML parsen
function parseVinted(html) {
  const items = [];
  try {
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+});/);
    if (!jsonMatch) {
      console.log("[DEBUG] Kein __INITIAL_STATE__ JSON gefunden!");
      return items;
    }

    const state = JSON.parse(jsonMatch[1]);
    const catalog = state.catalog?.items || [];

    for (const it of catalog) {
      const title = it.title || "–";
      const url = `https://www.vinted.at/items/${it.id}`;
      const price = it.price?.amount || "–";
      const thumb = it.photos?.[0]?.url_full || null;

      items.push({ title, url, price, thumb, brand: it.brand?.title || "" });
    }
  } catch (err) {
    console.error("Fehler beim Parsen von Vinted JSON:", err.message);
  }
  return items;
}

// Item an Discord senden
async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        { name: "Preis", value: item.price + " €", inline: true },
        { name: "Suche", value: searchName, inline: true }
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

// Suche prüfen
async function checkSearch(search) {
  const html = await fetchVinted(search);
  if (!html) return;

  const items = parseVinted(html);

  console.log(`[INFO] ${items.length} Items gefunden für Suche: "${search.name}"`);

  for (const item of items) {
    const brandOk = !search.brand || item.brand.toLowerCase().includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || item.price <= search.max_price;

    if (!seen[item.url] && brandOk && priceOk) {
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
    await webhook.send("✅ Vinted-Sniper ist online und Webhook funktioniert!");
    console.log("[INFO] Webhook-Test erfolgreich!");
  } catch (err) {
    console.error("[FEHLER] Webhook-Test fehlgeschlagen:", err.message);
  }

  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();
