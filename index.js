const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook erstellen
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Objekt, um schon gesendete Items zu speichern
let seen = {}; // verhindert doppelte Benachrichtigungen

// --- Funktionen ---

// Items von Vinted API abrufen
async function fetchVinted(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                      "(KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    });

    console.log("[DEBUG] Items von API erhalten:", res.data.items?.length || 0);
    return res.data.items || [];
  } catch (err) {
    console.error("Fehler beim Abrufen von Vinted API:", err.message);
    return [];
  }
}

// Items filtern nach Preis, Marke, Keywords
function filterItems(items, search) {
  return items.filter(it => {
    const title = it.title || "";
    const description = it.description || "";
    const txt = (title + " " + description).toLowerCase();

    const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
    const priceOk = !search.max_price || (it.price?.amount && it.price.amount <= search.max_price);
    let qualityOk = true;
    if (search.quality_keywords && search.quality_keywords.length > 0) {
      qualityOk = search.quality_keywords.some(q => txt.includes(q.toLowerCase()));
    }

    return brandOk && priceOk && qualityOk;
  }).map(it => ({
    title: it.title,
    url: it.url || `https://www.vinted.fr/items/${it.id}`,
    price: it.price?.amount || "–",
    thumb: it.photos?.[0]?.url_full || null
  }));
}

// Embed auf Discord senden
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

// Items prüfen und ggf. senden
async function checkSearch(search) {
  const items = await fetchVinted(search.query_url);
  if (!items.length) return;

  const filtered = filterItems(items, search);
  console.log(`[INFO] ${filtered.length} Items nach Filter für Suche: "${search.name}"`);

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
    const search = config.searches[0]; // nur erste Suche
    await checkSearch(search);
  }, config.check_interval_seconds * 1000);
}

main();
