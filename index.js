// index.js - Vinted Sniper minimal & prêt
// Usage: définir DISCORD_WEBHOOK en variable d'environnement (Replit/Render/GitHub Secrets)
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { WebhookClient } = require("discord.js");

const SEEN_FILE = path.join(__dirname, "seen.json");
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || "";
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000", 10); // 60s par défaut

if (!WEBHOOK_URL) {
  console.error("ERREUR: définis DISCORD_WEBHOOK (variable d'environnement).");
  process.exit(1);
}
const webhook = new WebhookClient({ url: WEBHOOK_URL });

// load config
let config = { searches: [] };
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname,"config.json"),"utf8"));
} catch(e){
  console.warn("Aucun config.json ou contenu invalide. Crée config.json depuis config.json.example.");
}

// load seen
let seen = {};
try { if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE,"utf8")) || {}; }
catch(e){ seen = {}; }

function saveSeen(){ try{ fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), "utf8"); }catch(e){} }

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
  for(const s of config.searches || []){
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
        const embed = {
          title: it.title?.substring(0,256) || "Annonce",
          url: it.link,
          fields: [{ name:"Prix", value: it.price ? `${it.price} €` : "-", inline:true }],
          timestamp: new Date().toISOString()
        };
        if(it.img) embed.image = { url: it.img };
        await webhook.send({ embeds: [embed] });
        console.log("Sent", it.link);
        seen[it.link] = { t: Date.now(), title: it.title };
        sent++;
      }catch(e){ console.error("Discord send error:", e.message); }
    }
    if(sent>0) saveSeen();
  }
}

(async function main(){
  console.log("Sniper started, interval ms:", CHECK_INTERVAL_MS);
  while(true){
    await processAll();
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS + Math.floor(Math.random()*5000)));
  }
})();
