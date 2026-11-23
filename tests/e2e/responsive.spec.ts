import { expect, test } from "@playwright/test";
import { captureSamplesAndRead, noHorizontalOverflow, planFromBase, resolveDemoDoubts, startDemo } from "./helpers.ts";

for (const width of [360, 390, 768, 1440]) {
  test(`telas principais em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 800 });
    await page.goto("/");
    await noHorizontalOverflow(page);
    await startDemo(page);
    await noHorizontalOverflow(page);
    const nav = page.getByRole("navigation", { name: "Principal" });
    await expect(nav.filter({ visible: true })).toHaveCount(1);
    for (const label of ["Início", "Nova rota", "Histórico", "Perfil"]) await expect(nav.filter({ visible: true }).getByRole("link", { name: label })).toBeVisible();

    await captureSamplesAndRead(page);
    await noHorizontalOverflow(page);
    await resolveDemoDoubts(page);
    await planFromBase(page);
    await noHorizontalOverflow(page);
    // botões principais com área de toque ≥ 48 px
    const start = await page.getByRole("button", { name: /Iniciar entregas/ }).boundingBox();
    expect(start!.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: `test-results/rota-${width}.png`, fullPage: false });
    await page.getByRole("button", { name: /Iniciar entregas/ }).click();
    await page.waitForURL("**/entrega");
    await noHorizontalOverflow(page);
    for (const name of [/Navegar no Google Maps/, /^Entregue$/, /Voltar depois/, /Não foi possível entregar/]) {
      const b = await page.getByRole(name.source.includes("Navegar") ? "link" : "button", { name }).boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: `test-results/entrega-${width}.png`, fullPage: false });
    for (const path of ["/app", "/app/historico", "/app/perfil", "/app/nova"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalOverflow(page);
    }
    await page.goto("/app");
    await page.screenshot({ path: `test-results/inicio-${width}.png`, fullPage: false });
  });
}
