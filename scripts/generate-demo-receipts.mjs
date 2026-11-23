// Gera as imagens de exemplo da demonstração (notinhas fictícias) e os ícones do PWA.
// Uso: npm run demo:assets   (requer o Chromium do Playwright)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { DEMO_PHOTOS, DEMO_RESTAURANT } from "../src/data/demoFixtures.ts";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function receiptHtml(r, i) {
  const rot = [-2.2, 1.4, -0.8, 2.0, -1.5][i % 5];
  const number = r.illegibleNumber
    ? `<span style="filter:blur(2.6px);opacity:.75">1?8</span>`
    : esc(r.number);
  return `<div class="r" style="transform:rotate(${rot}deg)">
    <div class="c b">${esc(DEMO_RESTAURANT.name.replace(" (fictícia)", "").toUpperCase())}</div>
    <div class="c s">R. Afonso Celso, 77 - V. Mariana</div>
    <div class="c s">CNPJ 00.000.000/0001-00 (FICTÍCIO)</div>
    <hr/>
    <div class="b big">PEDIDO #${esc(r.code)}</div>
    <div class="s">23/11/2026 19:${10 + i * 3} - DELIVERY</div>
    <hr/>
    ${r.items.map((it) => `<div>${esc(it)}</div>`).join("")}
    <div class="b">TOTAL ${esc(r.total)}</div>
    <hr/>
    <div class="b">ENTREGA</div>
    <div>${esc(r.name)}</div>
    <div class="addr">${esc(r.street)}, ${number}</div>
    ${r.complement ? `<div>${esc(r.complement)}</div>` : ""}
    <div>${esc(r.neighborhood)}</div>
    ${r.reference ? `<div>Ref: ${esc(r.reference)}</div>` : ""}
    ${r.phone ? `<div>Tel: ${esc(r.phone)}</div>` : ""}
    ${r.note ? `<div class="s">Obs: ${esc(r.note)}</div>` : ""}
    <hr/>
    <div class="c s">Obrigado pela preferência!</div>
  </div>`;
}

function pageHtml(receipts) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:${receipts.length * 430 + 80}px;height:860px;background:
      radial-gradient(circle at 30% 20%, #8a6a4a 0, #6e5238 55%, #5a4230 100%);display:flex;gap:26px;align-items:flex-start;padding:60px 40px;box-sizing:border-box}
    .r{width:390px;background:#fbfaf5;box-shadow:0 10px 26px rgba(0,0,0,.35);padding:30px 26px;font:24px/1.38 "DejaVu Sans Mono","Courier New",monospace;color:#222;border-radius:3px}
    .c{text-align:center}.b{font-weight:700}.s{font-size:19px;color:#444}.big{font-size:30px}
    .addr{font-weight:700;font-size:26px}
    hr{border:0;border-top:2px dashed #999;margin:12px 0}
  </style></head><body>${receipts.map(receiptHtml).join("")}</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const photo of DEMO_PHOTOS) {
  await page.setViewportSize({ width: photo.receipts.length * 430 + 80, height: 860 });
  await page.setContent(pageHtml(photo.receipts));
  await page.screenshot({ path: `public${photo.file}`, type: "jpeg", quality: 86 });
  console.log("gerado", photo.file);
}
const svg = readFileSync("public/favicon.svg", "utf8");
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["icon-maskable-512.png", 512, 64]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#1F2421;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
  console.log("gerado", name);
}
await browser.close();
