const puppeteer = require("puppeteer-core");
const { WebhookClient } = require("discord.js");

const webhook = new WebhookClient({ url: process.env.DISCORD_WEBHOOK });

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto("https://www.vinted.at/catalog?search_text=Nike", { waitUntil: "networkidle2" });

  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("div.feed-grid__item")).map(el => ({
      title: el.querySelector("a.item-card__title")?.innerText,
      url: el.querySelector("a.item-card__title")?.href,
      price: el.querySelector("span[itemprop='price']")?.innerText
    }));
  });

  console.log(items);
  if (items.length > 0) await webhook.send(`Found ${items.length} items!`);

  await browser.close();
}

run();
