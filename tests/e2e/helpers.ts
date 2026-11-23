import { expect, type Page } from "@playwright/test";

export async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Experimentar com dados fictícios/ }).click();
  await page.waitForURL("**/app");
  await expect(page.getByText("Modo demonstração")).toBeVisible();
}

export async function captureSamplesAndRead(page: Page) {
  await page.goto("/app/nova");
  await page.getByRole("button", { name: /Usar fotos de exemplo/ }).click();
  await page.getByRole("button", { name: /Ler notinhas \(2 fotos\)/ }).click({ timeout: 30_000 });
  await page.waitForURL("**/enderecos", { timeout: 30_000 });
}

/** Resolve as duas dúvidas da demonstração: número ilegível (pino) e notinha repetida (retirar). */
export async function resolveDemoDoubts(page: Page) {
  await page.getByRole("button", { name: /Pedido #2045/ }).click();
  await page.getByRole("button", { name: /Ajustar no mapa/ }).click();
  const map = page.getByRole("img", { name: /Ajuste do local/ });
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.getByRole("button", { name: "Usar este ponto" }).click();
  await expect(page.getByRole("dialog").getByText("Pronto", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const dup = page.locator("li", { hasText: "Possível pedido repetido" });
  await dup.getByRole("button").click();
  await page.getByRole("button", { name: "Retirar repetido" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

export async function planFromBase(page: Page) {
  await page.getByRole("button", { name: /^Organizar rota$/ }).click();
  await page.getByRole("button", { name: "Calcular rota" }).click();
  await page.waitForURL("**/rota", { timeout: 30_000 });
}

export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(r.sw, `overflow horizontal: ${r.sw} > ${r.w}`).toBeLessThanOrEqual(r.w + 1);
}
