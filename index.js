const puppeteer = require("puppeteer");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook erstellen
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Bereits gesendete Items merken
let seen = {};

// Vinted Seite scrapen
async function fetchVinted(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2" });
    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll(".catalog-grid__item"); // alle Items
      return Array.from(nodes).map(n => {
        const titleNode = n.querySelector(".item-box__title");
        const priceNode = n.querySelector(".item-box__price");
        const thumbNode = n.querySelector("img");
        const linkNode = n.querySelector("a");

        return {
          title: titleNode?.innerText || "–",
          url: linkNode?.href || "–",
          price: priceNode?.innerText || "–",
          thumb: thumbNode?.src || null
        };
      });
    });

    await browser.close();
    return items;
  } catch (err) {
    console.error("Fehler beim Scrapen von Vinted:", err.message);
    await browser.close();
    return [];
  }
}

// Discord Embed senden
async function sendDiscord(item) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        { name: "Preis", value: item.price, inline: true }
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

// Suche checken
async function checkSearch(search) {
  const items = await fetchVinted(search.query_url);

  // Filter nach Marke
  const filtered = items.filter(i => i.title.toLowerCase().includes(search.brand.toLowerCase()));

  console.log(`[INFO] ${filtered.length} Items gefunden für ${search.brand}`);

  for (const item of filtered) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      await sendDiscord(item);
    }
  }
}

// Main
async function main() {
  console.log("🚀 Vinted Sniper läuft alle", config.check_interval_seconds, "Sekunden");

  // Test Webhook
  try {
    await webhook.send("✅ Vinted-Sniper ist online!");
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
