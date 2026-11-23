import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const times = process.argv.slice(2).map(Number);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(pathToFileURL(resolve("scripts/video/motion.html")).href); await p.waitForTimeout(800);
for (const t of times) { await p.evaluate((x) => window.render(x), t); await p.screenshot({ path: `scripts/video/prev-${t}.png` }); }
await b.close();
