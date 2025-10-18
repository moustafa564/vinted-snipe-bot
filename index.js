const axios = require("axios");
const { WebhookClient, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));

const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

let seen = {}; // annonces déjà vues

async function fetchVinted(url) {
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (e) {
    console.error("Erreur fetch Vinted:", e.message);
    return null;
  }
}

function parseItems(html) {
  // simple regex pour extraire les liens d'items (approx)
  const regex = /\/items\/\d+/g;
  const matches = html.match(regex);
  if (!matches) return [];
  // on met https://www.vinted.fr devant si nécessaire
  return [...new Set(matches)].map(path => "https://www.vinted.fr" + path);
}

async function sendDiscord(title, url, price) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setURL(url)
      .addFields(
        { name: "Prix", value: price ? price + " €" : "–", inline: true }
      )
      .setTimestamp()
      .setColor(0x00ff00);
    await webhook.send({ embeds: [embed] });
    console.log("[OK] Embed envoyé:", title);
  } catch (err) {
    console.error("Erreur webhook:", err.message);
  }
}

async function checkSearch(search) {
  const html = await fetchVinted(search.query_url);
  if (!html) return;
  const items = parseItems(html);
  for (const url of items) {
    if (!seen[url]) {
      seen[url] = true;
      // pour simplifier, titre = dernière partie du lien, prix inconnu (tu peux améliorer)
      const title = url.split("/").pop();
      const price = Math.floor(Math.random() * (search.max_price || 50)) + 1; // simule un prix
      await sendDiscord(title, url, price);
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