// index.js - Render-ready keepalive
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { WebhookClient } = require("discord.js");

const SEEN_FILE = path.join(__dirname, "seen.json");
const CONFIG_FILE = path.join(__dirname, "config.json");

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || "";
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000", 10); // 60s par défaut

if (!WEBHOOK_URL) console.warn("⚠️ DISCORD_WEBHOOK non défini dans l'environnement. Configure-le sur Render.");
const webhook = WEBHOOK_URL ? new WebhookClient({ url: WEBHOOK_URL }) : null;

let config = { searches: [] };
try {
  if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  else console.warn("Aucun config.json trouvé — crée config.json depuis config.json.example");
} catch(e) { console.warn("Erreur parsing config.json:", e.message); }

let seen = {};
try { if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) || {}; } catch(e){ seen = {}; }
function saveSeen(){ try{ fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), "utf8"); } catch(e){ console.warn("Erreur écriture seen.json:", e.message); } }

function parsePrice(text){ if(!text) return null; const s = text.replace(/\s|€|\u202f/g,"").replace(",","."); const n = parseFloat(s); return isNaN(n) ? null : n; }

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
    const uniq = []; const set = new Set();
    for(const it of found){ if(!set.has(it.link)){ set.add(it.link); uniq.push(it); } }
    let sent = 0;
    for(const it of uniq){
      if (sent >= (s.max_sends_per_run || 2)) break;
      if (seen[it.link]) continue;
      if (s.brand && !(it.title||"").toLowerCase().includes(s.brand.toLowerCase())) continue;
      if (s.max_price && it.price !== null && it.price > Number(s.max_price)) continue;
      if (s.quality_keywords && s.quality_keywords.length>0){
        const ok = s.quality_keywords.some(q => (it.title||"").toLowerCase().includes(q.toLowerCase()));
        if(!ok) continue;
      }
      try{
        if (webhook) {
          const embed = {
            title: it.title?.substring(0,256) || "Annonce",
            url: it.link,
            fields: [{ name:"Prix", value: it.price ? `${it.price} €` : "-", inline:true }],
            timestamp: new Date().toISOString()
          };
          if (it.img) embed.image = { url: it.img };
          await webhook.send({ embeds: [embed] });
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
  console.log("Sniper loop started. Interval ms:", CHECK_INTERVAL_MS);
  while(running){
    try { await processAll(); } catch(e){ console.error("processAll error:", e.message || e); }
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS + Math.floor(Math.random()*3000)));
  }
}

// Express keepalive + health
const app = express();
app.get("/", (req, res) => res.send("OK - vinted-sniper running"));
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));
const port = process.env.PORT || 3000;
app.listen(port, () => { console.log("Keepalive server listening on port", port); loop().catch(err => console.error("loop error:", err)); });

// graceful shutdown
process.on("SIGTERM", ()=>{ console.log("SIGTERM, shutting down"); running = false; process.exit(0); });
process.on("SIGINT", ()=>{ console.log("SIGINT, shutting down"); running = false; process.exit(0); });