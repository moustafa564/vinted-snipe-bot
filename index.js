// index.js - Vinted Sniper (secure: webhook via env, keepalive, backoff)
// Usage: set DISCORD_WEBHOOK env (required). Optionally CHECK_INTERVAL_MS (ms).
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { WebhookClient } = require("discord.js");

const SEEN_FILE = path.join(__dirname, "seen.json");
const CONFIG_FILE = path.join(__dirname, "config.json");

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || "";
const DEFAULT_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || "60000", 10); // 60s par défaut
const MIN_INTERVAL_MS = 1000; // sécurité: 1s min
const JITTER_MS = 2000; // jitter aléatoire
const MAX_SENDS_PER_RUN_GLOBAL = parseInt(process.env.MAX_SENDS_PER_RUN || "2", 10);

if (!WEBHOOK_URL) {
  console.error("ERREUR: définis la variable d'environnement DISCORD_WEBHOOK avec ton webhook Discord.");
  process.exit(1);
}
const webhook = new WebhookClient({ url: WEBHOOK_URL });

let config = { searches: [] };
try {
  if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  else console.warn("Avertissement: config.json introuvable. Copie config.json.example -> config.json");
} catch (e) {
  console.warn("Erreur parsing config.json:", e.message);
}

let seen = {};
try { if (fs.existsSync(SEEN_FILE)) seen = JSON.parse(fs.readFileSync(SEEN_FILE,"utf8")) || {}; } catch(e){ seen = {}; }
function saveSeen(){ try{ fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), "utf8"); } catch(e){ console.warn("Erreur save seen.json:", e.message); } }

function parsePrice(text){
  if(!text) return null;
  const s = text.replace(/\s|€|\u202f/g,"").replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function fetchSearch(search){
  try{
    const res = await axios.get(search.query_url, {
      headers: { "User-Agent": process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 20000
    });
    const $ = cheerio.load(res.data);
    const items = [];
    $('a[href*="/items/"]').each((i, el) => {
      try{
        const a = $(el);
        let href = a.attr("href") || "";
        if (href.startsWith("/")) href = "https://www.vinted.fr" + href;
        const title = (a.find(".ItemBox__title, .title, .item-box__title").first().text().trim()) ||
                      (a.attr("title")||"").trim() || a.text().trim().slice(0,120);
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

let backoffMultiplier = 1;
async function processAll(){
  for (const s of (config.searches || [])) {
    const found = await fetchSearch(s);
    if (!found) continue;
    const uniq = [];
    const set = new Set();
    for (const it of found) { if (!set.has(it.link)) { set.add(it.link); uniq.push(it); } }
    let sent = 0;
    const maxPerRun = s.max_sends_per_run || MAX_SENDS_PER_RUN_GLOBAL;
    for (const it of uniq){
      if (sent >= maxPerRun) break;
      if (seen[it.link]) continue;
      const txt = (it.title||"").toLowerCase();
      if (s.brand && !txt.includes((s.brand||"").toLowerCase())) continue;
      if (s.max_price && it.price !== null && it.price > Number(s.max_price)) continue;
      if (s.quality_keywords && s.quality_keywords.length>0){
        const ok = s.quality_keywords.some(q => txt.includes(q.toLowerCase()));
        if (!ok) continue;
      }
      try {
        const embed = {
          title: it.title?.substring(0,256) || "Annonce",
          url: it.link,
          fields: [{ name: "Prix", value: it.price ? `${it.price} €` : "-", inline: true }],
          timestamp: new Date().toISOString()
        };
        if (it.img) embed.image = { url: it.img };
        await webhook.send({ embeds: [embed] });
        console.log("[OK] Sent:", it.link);
        seen[it.link] = { t: Date.now(), title: it.title };
        sent++;
      } catch (e) {
        console.error("[ERR] Discord send:", e.message || e);
      }
    }
    if (sent>0) saveSeen();
  }
}

async function loop(){
  console.log("Sniper main loop starting");
  while(true){
    try {
      await processAll();
      backoffMultiplier = 1; // reset on success
    } catch(e){
      console.error("processAll error:", e.message || e);
      // soft backoff on unexpected error
      backoffMultiplier = Math.min(backoffMultiplier * 2, 64);
    }
    // compute wait
    let wait = Math.max(DEFAULT_INTERVAL_MS * backoffMultiplier, MIN_INTERVAL_MS);
    // safety: minimum 1s and add jitter
    if (wait < MIN_INTERVAL_MS) wait = MIN_INTERVAL_MS;
    const jitter = Math.floor(Math.random() * JITTER_MS);
    console.log(`Waiting ${wait}ms (+${jitter}ms jitter) before next cycle (backoff x${backoffMultiplier})`);
    await new Promise(r => setTimeout(r, wait + jitter));
  }
}

// Express keepalive & health
const app = express();
app.get("/", (req, res) => res.send("OK - vinted-sniper running"));
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Keepalive listening on port", port);
  // start main loop after server ready
  loop().catch(err => console.error("Loop failed:", err));
});

// graceful shutdown
process.on("SIGTERM", () => { console.log("SIGTERM, shutdown"); process.exit(0); });
process.on("SIGINT", () => { console.log("SIGINT, shutdown"); process.exit(0); });