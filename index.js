// index.js - vinted-sniper (Render-ready with keepalive)
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { WebhookClient } = require("discord.js");

const SEEN_FILE = path.join(__dirname, "seen.json");
const CONFIG_FILE = path.join(__dirname, "config.json");

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || "";
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000", 10); // 60s
if (!WEBHOOK_URL) {
  console.error("ERREUR: définis DISCORD_WEBHOOK en variable d'environnement sur Render.");
  // on continue pour debug, mais tu devrais ajouter la variable
}

const webhook = WEBHOOK_URL ? new WebhookClient({ url: WEBHOOK_URL }) : null;

// load config (fallback to example)
let config = { searches: [] };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } else {
    console.warn("Aucun config.json trouvé — crée config.json à partir de config.json.example");
  }
} catch (e) {
  console.warn("Erreur lecture config.json:", e.message);
}

// load seen
let seen = {};
try { if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) || {}; }
catch(e){ console.warn("Impossible de lire seen.json:", e.message); seen = {}; }
function saveSeen(){ try{ fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), "utf8"); }catch(e){ console.warn("Erreur écriture seen.json:", e.message);} }

function parsePrice(text){
  if(!text) return null;
  const s = text.replace(/\s|€|\u202f/g,"").replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function fetchSearch(search){
  try{
    const res = await axios.get(search.query_url, { headers: { "User-Agent": process.env.USER_AGENT || "Mozilla/5.0" }, timeout: 20000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $('a[href*="/items/"]').each((i, el) => {
      try{
        const a = $(el);
        let href = a.attr("href") || "";
        if (href.startsWith("/")) href = "https://www.vinted.fr" + href;
        const title = (a.find(".ItemBox__title, .title, .item-box__title").first().text().trim()) || (a.attr("title")||"").trim() || a.text().trim().slice(0,120);
        const priceText = a.find(".ItemBox__price, .price, .item-box__price").first().text() || "";
        const price = parsePrice(priceText);
        const imgEl = a.find("img").first();
        const img = imgEl && (imgEl.attr("src") || imgEl.attr("data-src")) ? (imgEl.attr("src") || imgEl.attr("data-src")) : null;
        items.push({ title, link: href, price, img });
      }catch(e){}
    });
    return items;
  }catch(e){
    console.error("fetchSearch error:", search.name || search.query_url, e.message || e);
    return null;
  }
}

async function processAll(){
  for(const s of (config.searches || [])){
    const found = await fetchSearch(s);
    if(!found) continue;
    const uniq = [];
    const set = new Set();
    for(const it of found){ if(!set.has(it.link)){ set.add(it.link); uniq.push(it); } }
    let sent = 0;
    for(const it of uniq){
      if(sent >= (s.max_sends_per_run || 2)) break;
      if(seen[it.link]) continue;
      // brand filter
      if(s.brand && !(it.title||"").toLowerCase().includes(s.brand.toLowerCase())) continue;
      if(s.max_price && it.price !== null && it.price > Number(s.max_price)) continue;
      // quality keywords
      if(s.quality_keywords && s.quality_keywords.length>0){
        const ok = s.quality_keywords.some(q => (it.title||"").toLowerCase().includes(q.toLowerCase()));
        if(!ok) continue;
      }
      // send
      try{
        if (webhook) {
          const embed = {
            title: it.title?.substring(0,256) || "Annonce",
            url: it.link,
            fields: [{ name:"Prix", value: it.price ? `${it.price} €` : "-", inline:true }],
            timestamp: new Date().toISOString()
          };
          if(it.img) embed.image = { url: it.img };
          await webhook.send({ embeds: [embed] });
          console.log("Sent", it.link);
        } else {
          console.log("Webhook non configuré — item:", it.link);
        }
        seen[it.link] = { t: Date.now(), title: it.title };
        sent++;
      }catch(e){ console.error("Discord send error:", e.message); }
    }
    if(sent>0) saveSeen();
  }
}

let running = true;
async function loop(){
  console.log("Sniper started, interval ms:", CHECK_INTERVAL_MS);
  while(running){
    try {
      await processAll();
    } catch(e){
      console.error("Erreur processAll:", e.message || e);
    }
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS + Math.floor(Math.random()*5000)));
  }
}

// --- Express keepalive & health endpoint (important pour Render)
const app = express();
app.get("/", (req, res) => res.send("OK - vinted-sniper is running"));
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Keepalive server listening on port", port);
  // start the bot loop after the server listens
  loop().catch(err => console.error("Loop error:", err));
});

// graceful shutdown
process.on("SIGTERM", () => { console.log("SIGTERM received, shutting down..."); running = false; process.exit(0); });
process.on("SIGINT", () => { console.log("SIGINT received, shutting down..."); running = false; process.exit(0); });