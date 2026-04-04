const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// --- CONFIG einlesen ---
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook erstellen
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Schon gesendete Items speichern, um Duplikate zu vermeiden
let seen = {};

// --- FUNKTIONEN ---

// HTML von Vinted abrufen
async function fetchVinted(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "de-DE,de;q=0.9"
      }
    });
    return res.data;
  } catch (err) {
    console.error("❌ Fehler beim Abrufen von Vinted:", err.message);
    return null;
  }
}

// Items aus HTML parsen
function parseVinted(html, search) {
  const items = [];
  try {
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+});/);
    if (!jsonMatch) {
      console.log("[DEBUG] Kein __INITIAL_STATE__ JSON gefunden!");
      return items;
    }

    const state = JSON.parse(jsonMatch[1]);
    const catalog = state.catalog?.items || [];
    console.log(`[DEBUG] Items gefunden: ${catalog.length} für Suche "${search.name}"`);

    for (const it of catalog) {
      const title = it.title || "–";
      const url = it.url || (() => {
        const base = new URL(search.query_url).origin;
        return base + "/items/" + it.id;
      })();
      const price = it.price?.amount || "–";
      const thumb = it.photos?.[0]?.url_full || null;

      const txt = (title + " " + (it.description || "")).toLowerCase();

      // Filter
      const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
      const priceOk = !search.max_price || (price !== "–" && price <= search.max_price);

      let qualityOk = true;
      if (search.quality_keywords && search.quality_keywords.length > 0) {
        qualityOk = search.quality_keywords.some(q => txt.includes(q.toLowerCase()));
      }

      if (brandOk && priceOk && qualityOk) {
        items.push({ title, url, price, thumb });
      }
    }
  } catch (err) {
    console.error("❌ Fehler beim Parsen von Vinted JSON:", err.message);
  }
  return items;
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
