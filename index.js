const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const cheerio = require("cheerio");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

let seen = {}; // annonces déjà envoyées

async function fetchVinted(url) {
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    console.error("Erreur fetch Vinted:", err.message);
    return null;
  }
}

function parseVinted(html, search) {
  const $ = cheerio.load(html);
  const items = [];

  $('a[href*="/items/"]').each((i, el) => {
    try {
      const href = $(el).attr("href");
      const url = href.startsWith("http") ? href : "https://www.vinted.fr" + href;
      if (seen[url]) return;

      const title = $(el).find(".ItemBox__title, .title").first().text().trim() || "–";
      const priceText = $(el).find(".ItemBox__price, .price").first().text().trim();
      const price = priceText ? parseFloat(priceText.replace(/\D/g, "")) : "–";
      const thumb = $(el).find("img").attr("src");

      // filtrage marque, prix, qualité
      const txt = title.toLowerCase();
      const brandOk = !search.brand || txt.includes(search.brand.toLowerCase());
      const priceOk = !search.max_price || (price !== "–" && price <= search.max_price);

      let qualityOk = true;
      if (search.quality_keywords && search.quality_keywords.length > 0) {
        qualityOk = search.quality_keywords.some(q => txt.includes(q.toLowerCase()));
      }

      if (brandOk && priceOk && qualityOk) {
        items.push({ title, url, price, thumb });
      }
    } catch (e) {}
  });

  return items;
}

async function sendDiscord(item, searchName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(item.title)
      .setURL(item.url)
      .addFields(
        { name: "Prix", value: item.price !== "–" ? item.price + " €" : "–", inline: true },
        { name: "Recherche", value: searchName || "–", inline: true }
      )
      .setTimestamp()
      .setColor(0x00ff00);

    if (item.thumb) embed.setImage(item.thumb);

    await webhook.send({ embeds: [embed] });
    console.log("[OK] Embed envoyé:", item.title);
  } catch (err) {
    console.error("[ERR] Envoi Discord:", err.message);
  }
}

async function checkSearch(search) {
  const html = await fetchVinted(search.query_url);
  if (!html) return;
  const items = parseVinted(html, search);

  for (const item of items) {
    if (!seen[item.url]) {
      seen[item.url] = true;
      await sendDiscord(item, search.name);
    }
  }
}

async function main() {
  console.log("Sniper Vinted démarré toutes les", config.check_interval_seconds, "secondes.");
  setInterval(async () => {
    for (const search of config.searches) {
      await checkSearch(search);
    }
  }, config.check_interval_seconds * 1000);
}

main();