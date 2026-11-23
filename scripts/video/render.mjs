import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
const FPS = 30, OUT = "scripts/video/frames";
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(pathToFileURL(resolve("scripts/video/motion.html")).href); await p.waitForTimeout(1000);
const dur = await p.evaluate(() => window.DURATION);
const n = Math.round(dur * FPS);
for (let i = 0; i < n; i++) {
  await p.evaluate((t) => window.render(t), i / FPS);
  await p.screenshot({ path: `${OUT}/${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 95 });
  if (i % 300 === 0) console.log("frame", i, "/", n);
}
await b.close();
