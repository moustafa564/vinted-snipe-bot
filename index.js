const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config laden
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Discord Webhook
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Bereits gesendete Items speichern
let seen = {};

// 🔹 Vinted API abrufen (mit richtigen Headers gegen 401/403)
async function fetchVinted(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.vinted.at/",
      },
    });

    console.log("[DEBUG] API Antwort OK");
    return res.data.items || [];
  } catch (err) {
    console.error("❌ Fehler bei Vinted:", err.message);
    return [];
  }
}

// 🔹 Items filtern
function parseVinted(items, search) {
  const results = [];

  for (const it of items) {
    const title = it.title || "–";
    const url = `https://www.vinted.at/items/${it.id}`;
    const price = it.price?.amount || "–";
    const thumb = it.photos?.[0]?.url_full || null;

    const txt = (title + " " + (it.description || "")).toLowerCase();

    const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
    const priceOk =
      !search.max_price || (price !== "–" && price <= search.max_price);

    if (brandOk && priceOk) {
      results.push({ title, url, price, thumb });
    }
  }

  return results;
}

// 🔹 Discord senden
async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        {
          name: "Preis",
          value: item.price !== "–" ? item.price + " €" : "–",
          inline: true,
        },
        { name: "Suche", value: searchName, inline: true }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    if (item.thumb) embed.setImage(item.thumb);

    await webhook.send({ embeds: [embed] });
    console.log("✅ Gesendet:", item.title);
  } catch (err) {
    console.error("❌ Discord Fehler:", err.message);
  }
}

// 🔹 Suche checken
async function checkSearch(search) {
  const items = await fetchVinted(search.query_url);

  console.log(`[INFO] ${items.length} Items gefunden`);

  const filtered = parseVinted(items, search);

  console.log(`[INFO] ${filtered.length} nach Filter`);

  for (const item of filtered) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      await sendDiscord(item, search.name);
    }
  }
}

// 🔹 MAIN
async function main() {
  console.log(
    "🚀 Vinted Sniper läuft alle",
    config.check_interval_seconds,
    "Sekunden"
  );

  // Test Nachricht
  try {
    await webhook.send("✅ Bot läuft und ist verbunden!");
  } catch (err) {
    console.error("Webhook Fehler:", err.message);
  }

  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();
