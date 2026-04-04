const puppeteer = require("puppeteer");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config einlesen
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook erstellen
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Schon gesendete Items
let seen = {};

// --- Funktionen ---

async function fetchVinted(url) {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    // User-Agent setzen, damit Vinted nicht blockt
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle0" });
    const html = await page.content();

    await browser.close();
    return html;
  } catch (err) {
    console.error("Fehler beim Abrufen von Vinted:", err.message);
    return null;
  }
}

function parseVinted(html, search) {
  const items = [];
  try {
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+});/);
    if (!jsonMatch) return items;

    const state = JSON.parse(jsonMatch[1]);
    const catalog = state.catalog?.items || [];

    for (const it of catalog) {
      const title = it.title || "–";
      const url = it.url || (() => {
        const base = new URL(search.query_url).origin;
        return base + "/items/" + it.id;
      })();
      const price = it.price?.amount || "–";
      const thumb = it.photos?.[0]?.url_full || null;

      const txt = (title + " " + (it.description || "")).toLowerCase();

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
    console.error("Fehler beim Parsen von Vinted JSON:", err.message);
  }
  return items;
}

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
  console.log("🚀 Vinted Sniper läuft alle", config.check_interval_seconds, "Sekunden");

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
