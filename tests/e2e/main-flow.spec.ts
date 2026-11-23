import { expect, test } from "@playwright/test";
import { captureSamplesAndRead, planFromBase, resolveDemoDoubts, startDemo } from "./helpers.ts";

test.use({ viewport: { width: 390, height: 844 } });

test("fluxo principal: fotos → pedidos → dúvidas → rota → entregas → resumo", async ({ page }) => {
  await startDemo(page);
  await captureSamplesAndRead(page);

  // 2 fotos (5 + 3 notinhas) = 8 pedidos lidos; o cabeçalho do restaurante não vira entrega
  await expect(page.getByText(/8 pedidos · 6 prontos · 2 para resolver/)).toBeVisible();
  for (const code of ["2041", "2042", "2043", "2045", "2046", "2047"]) await expect(page.getByRole("button", { name: new RegExp(`Pedido #${code}`) }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Pedido #2044/ })).toHaveCount(2); // repetido sinalizado, não removido
  await expect(page.getByText("Possível pedido repetido")).toBeVisible();
  await expect(page.getByText("Número não identificado")).toBeVisible();
  // pedidos diferentes no mesmo endereço continuam separados
  await expect(page.getByText(/Mesmo endereço de Pedido #2043/)).toBeVisible();
  await expect(page.getByText(/Mesmo endereço de Pedido #2042/)).toBeVisible();

  // a rota fica bloqueada até as dúvidas serem resolvidas
  await expect(page.getByRole("button", { name: /^Organizar rota$/ })).toBeDisabled();
  await resolveDemoDoubts(page);
  await expect(page.getByText(/Fora desta saída \(1\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Organizar rota$/ })).toBeEnabled();

  await planFromBase(page);
  await expect(page.getByText("Sequência sugerida · simulação em linha reta")).toBeVisible();
  await expect(page.getByText(/7 pedidos/)).toBeVisible();
  await expect(page.locator("ol > li")).toHaveCount(6); // 6 paradas físicas para 7 pedidos
  await expect(page.getByText(/Mesmo endereço: 2 entregas separadas/)).toBeVisible();

  await page.getByRole("button", { name: /Iniciar entregas/ }).click();
  await page.waitForURL("**/entrega");
  await expect(page.getByText("0 de 7 entregas concluídas")).toBeVisible();

  const link = page.getByRole("link", { name: /Navegar no Google Maps/ });
  const href = (await link.getAttribute("href"))!;
  const u = new URL(href);
  expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
  expect(u.searchParams.get("api")).toBe("1");
  expect(u.searchParams.get("dir_action")).toBe("navigate");
  expect(u.searchParams.get("destination")).toMatch(/^-23\.\d{6},-46\.\d{6}$/);
  expect(await link.getAttribute("target")).toBe("_blank");

  // abrir o Maps NÃO conclui a entrega; ao voltar, o app pede o registro
  const [popup] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
  await popup.close();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("Voltou do Maps?")).toBeVisible();
  await expect(page.getByText("0 de 7 entregas concluídas")).toBeVisible();

  await page.getByRole("button", { name: /^Entregue$/ }).click();
  await expect(page.getByText("1 de 7 entregas concluídas")).toBeVisible();

  // atualizar a página preserva o progresso
  await page.reload();
  await expect(page.getByText("1 de 7 entregas concluídas")).toBeVisible();

  // voltar depois mantém pendente
  const before = await page.locator("p", { hasText: /^Pedido #/ }).first().innerText();
  await page.getByRole("button", { name: "Voltar depois" }).click();
  await expect(page.getByText(/1 de 7 entregas concluídas/)).toBeVisible();
  await expect(page.getByText(/6 restantes/)).toBeVisible();
  expect(await page.locator("p", { hasText: /^Pedido #/ }).first().innerText()).not.toBe(before);

  // sem sucesso, com motivo; depois desfazer
  await page.getByRole("button", { name: "Não foi possível entregar" }).click();
  await page.getByRole("button", { name: "Cliente ausente" }).click();
  await expect(page.getByText(/2 de 7 entregas concluídas/)).toBeVisible();
  await page.getByRole("button", { name: /Desfazer último registro/ }).click();
  await expect(page.getByText(/1 de 7 entregas concluídas/)).toBeVisible();

  // concluir o restante
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: /^Entregue$/ }).click();
  await expect(page.getByText("Todas as paradas resolvidas")).toBeVisible();
  await expect(page.getByText("7 de 7 entregas concluídas")).toBeVisible();
  await page.getByRole("button", { name: "Encerrar saída" }).click();
  await page.waitForURL("**/resumo");
  await expect(page.getByText("Planejamento (estimativa)")).toBeVisible();
  await expect(page.getByText("Registrado no app")).toBeVisible();
  await expect(page.getByRole("main").getByText("Concluído")).toBeVisible();
});

test("reenvio da mesma foto não duplica e foto arbitrária não recebe leitura fingida", async ({ page }) => {
  await startDemo(page);
  await page.goto("/app/nova");
  await page.getByRole("button", { name: /Usar fotos de exemplo/ }).click();
  await expect(page.getByRole("button", { name: /Ler notinhas \(2 fotos\)/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: /Usar fotos de exemplo/ }).click();
  await expect(page.getByText("Esta foto já está no lote.").first()).toBeVisible();
  await expect(page.getByText("Foto 3")).toHaveCount(0);

  // foto arbitrária (gerada no navegador): sem chave de OCR, nada de pedidos fictícios
  await page.goto("/app/nova");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 900;
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, 1200, 900); x.fillStyle = "#000"; x.font = "40px monospace"; x.fillText("Rua Qualquer, 99", 100, 200);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type=file][multiple]').setInputFiles({ name: "minha-foto.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: /Ler notinhas \(1 foto\)/ }).click({ timeout: 30_000 });
  await expect(page.getByText("Nenhum pedido identificado nas fotos.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/só as fotos de exemplo são lidas/)).toBeVisible();
  await page.getByRole("link", { name: /Incluir manualmente/ }).click();
  await expect(page.getByRole("dialog", { name: "Incluir pedido" })).toBeVisible();
  await page.getByLabel("Rua").fill("Rua Vergueiro");
  await page.getByLabel("Número").fill("2045");
  await page.getByRole("button", { name: "Incluir e localizar" }).click();
  await expect(page.getByText(/1 pedido · 1 prontos/)).toBeVisible();
});

test("lote inexistente ou de outra equipe mostra acesso negado", async ({ page }) => {
  await startDemo(page);
  await page.goto("/app/lote/7d1f3a1e-1111-4222-8333-944455556666");
  await expect(page.getByText("Acesso negado ou lote inexistente")).toBeVisible();
});

test("sem conexão: registro fica na fila local e sincroniza ao reconectar", async ({ page, context }) => {
  await startDemo(page);
  await captureSamplesAndRead(page);
  await resolveDemoDoubts(page);
  await planFromBase(page);
  await page.getByRole("button", { name: /Iniciar entregas/ }).click();
  await page.waitForURL("**/entrega");
  await context.setOffline(true);
  await expect(page.getByText(/Sem conexão/).first()).toBeVisible();
  await page.getByRole("button", { name: /^Entregue$/ }).click();
  await expect(page.getByText("1 de 7 entregas concluídas")).toBeVisible();
  const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rp:queue:")).map((k) => JSON.parse(localStorage.getItem(k)!).length));
  expect(queued).toEqual([1]);
  await expect(page.getByRole("button", { name: /Reorganizar \(precisa de internet\)/ })).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rp:queue:")).map((k) => JSON.parse(localStorage.getItem(k)!).length))).toEqual([0]);
  await page.reload();
  await expect(page.getByText("1 de 7 entregas concluídas")).toBeVisible(); // sem duplicar
});
