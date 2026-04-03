const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

let seen = {}; // pour ne pas renvoyer 2 fois la même annonce

async function fetchVinted(url) {
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (err) {
    console.error("Erreur fetch Vinted:", err.message);
    return null;
  }
}

// Récupère les items depuis le JSON caché dans la page
function parseVinted(html, search) {
  const items = [];
  try {
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s?=\s?({.*});/);
    if (!jsonMatch) return items;
    const state = JSON.parse(jsonMatch[1]);
    const catalog = state.catalog?.items || [];
    
    for (const it of catalog) {
      const title = it.title || "–";
      const url = "https://www.vinted.fr/items/" + it.id;
      const price = it.price.amount || "–";
      const thumb = it.photos?.[0]?.url_full || null;

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
    }
  } catch (err) {
    console.error("Erreur parse JSON:", err.message);
  }
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
