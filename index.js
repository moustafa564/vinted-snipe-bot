const { chromium } = require("playwright");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// Config laden
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

// Webhook
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

// Cache
let seen = {};

async function startBrowser() {
  return await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

async function fetchItems(page, search) {
  await page.goto(search.query_url, { waitUntil: "domcontentloaded" });

  // wichtig: warten bis content geladen ist
  await page.waitForSelector("div.feed-grid__item", { timeout: 15000 });

  return await page.evaluate(() => {
    const items = [];
    document.querySelectorAll("div.feed-grid__item").forEach(el => {
      const titleEl = el.querySelector("a.item-card__title");
      const priceEl = el.querySelector("span[itemprop='price']");
      const imgEl = el.querySelector("img[itemprop='image']");

      if (!titleEl) return;

      items.push({
        title: titleEl.innerText.trim(),
        url: "https://www.vinted.at" + titleEl.getAttribute("href"),
        price: priceEl ? priceEl.innerText.replace("€", "").trim() : null,
        thumb: imgEl ? imgEl.src : null
      });
    });
    return items;
  });
}

async function sendDiscord(item, searchName) {
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
  console.log("[OK]", item.title);
}

async function checkSearch(page, search) {
  try {
    const items = await fetchItems(page, search);

    console.log(`[INFO] ${items.length} Items für "${search.name}"`);

    for (const item of items) {
      const txt = item.title.toLowerCase();

      const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
      const priceOk = !search.max_price || (item.price && parseFloat(item.price) <= search.max_price);

      if (brandOk && priceOk) {
        if (!seen[item.url]) {
          seen[item.url] = true;
          await sendDiscord(item, search.name);
        }
      }
    }
  } catch (err) {
    console.log("❌ Fehler:", err.message);
  }
}

(async () => {
  const browser = await startBrowser();
  const page = await browser.newPage();

  console.log("🚀 Bot läuft...");

  await webhook.send("✅ Vinted Bot online!");

  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(page, search);
    }
  }, config.check_interval_seconds * 1000);
})();
