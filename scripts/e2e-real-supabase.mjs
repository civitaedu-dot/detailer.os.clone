// Fluxo REAL contra um Supabase local (supabase start) — sem OCR nem Google configurados.
// Pré-requisitos (ver README, "Teste do modo real"): usuários dono@restaurante.test, outro@pizzaria.test e
// moto@entregador.test com senha "senha-forte-123"; app rodando com VITE_SUPABASE_* apontando para o stack local.
// Uso: APP_URL=http://localhost:5175 node scripts/e2e-real-supabase.mjs
import { chromium } from "playwright";
const S = process.env.SHOTS_DIR ?? "test-results";
const URL0 = process.env.APP_URL ?? "http://localhost:5175";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: -23.5878, longitude: -46.6345, accuracy: 15 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 200)); });
const step = (s) => console.log("•", s);
await p.goto(URL0 + "/entrar");
await p.getByLabel("E-mail").fill("dono@restaurante.test");
await p.getByLabel("Senha").fill("senha-forte-123");
await p.getByRole("button", { name: "Entrar" }).click();
await p.waitForURL("**/configurar", { timeout: 15000 }); step("login → configurar");
await p.getByRole("button", { name: /Sou restaurante/ }).click();
await p.getByLabel(/Como aparece/).fill("Cantina Teste");
await p.getByRole("button", { name: "Continuar" }).click();
await p.getByLabel("Nome da base").fill("Cantina Teste");
await p.getByLabel(/Endereço/).fill("Rua Afonso Celso, 77 - Vila Mariana");
await p.getByLabel("Cidade").fill("São Paulo");
await p.getByRole("button", { name: /Verificar endereço/ }).click();
await p.getByText(/não está configurada/).waitFor(); step("geocoding ausente tratado");
await p.getByRole("button", { name: /Estou na base agora/ }).click();
await p.getByRole("button", { name: "Salvar e continuar" }).click();
await p.getByRole("button", { name: "Concluir" }).click();
await p.waitForURL(URL0 + "/app"); step("onboarding concluído");
await p.goto(URL0 + "/app/perfil");
await p.getByRole("button", { name: /Gerar código de convite/ }).click();
const code = (await p.locator("code").innerText()).trim(); step("convite " + code);
await p.goto(URL0 + "/app/nova");
await p.locator('input[type=file][multiple]').setInputFiles("public/demo/notinhas-foto-1.jpg");
await p.getByRole("button", { name: /Ler notinhas \(1 foto\)/ }).click({ timeout: 20000 });
await p.getByText("Nenhum pedido identificado nas fotos.").waitFor({ timeout: 30000 });
console.log("  nota:", await p.locator('[role=status]').filter({ hasText: /configurada/ }).first().innerText());
await p.screenshot({ path: `${S}/real-processing.png` }); step("upload ok + OCR não configurado → sem pedidos fictícios");
const batchUrl = p.url().replace("/processando", "");
await p.getByRole("link", { name: /Incluir manualmente/ }).click();
await p.waitForURL("**/enderecos**"); await p.getByRole("dialog").waitFor();
for (const [rua, num] of [["Rua Vergueiro", "2045"], ["Rua Cubatão", "1100"]]) {
  if (!(await p.getByRole("dialog").isVisible())) { await p.screenshot({ path: `${S}/real-before-add.png` }); await p.getByRole("button", { name: "Incluir pedido" }).click({ timeout: 8000 }); }
  await p.getByLabel("Rua").fill(rua); await p.getByLabel("Número").fill(num);
  await p.getByRole("button", { name: "Incluir e localizar" }).click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
}
step("2 pedidos manuais incluídos");
for (const code2 of ["Rua Vergueiro", "Rua Cubatão"]) {
  await p.getByRole("button", { name: new RegExp(code2) }).click();
  await p.getByRole("button", { name: /Ajustar no mapa/ }).click();
  const box = await p.getByRole("img", { name: /Ajuste do local/ }).boundingBox();
  await p.mouse.click(box.x + box.width * (code2.includes("Verg") ? 0.3 : 0.7), box.y + box.height * 0.4);
  await p.getByRole("button", { name: "Usar este ponto" }).click();
  await p.waitForTimeout(500);
  await p.keyboard.press("Escape");
}
await p.getByRole("button", { name: /^Organizar rota$/ }).click();
await p.getByRole("button", { name: "Calcular rota" }).click();
await p.waitForURL("**/rota", { timeout: 20000 }); step("rota calculada (simulação)");
console.log("  ", await p.getByText(/simulação em linha reta/).first().innerText());
await p.getByRole("button", { name: /Iniciar entregas/ }).click();
await p.waitForURL("**/entrega");
await p.getByRole("button", { name: /^Entregue$/ }).click();
await p.getByText("1 de 2 entregas concluídas").waitFor();
await p.reload(); await p.getByText("1 de 2 entregas concluídas").waitFor({ timeout: 15000 }); step("registro persistido no Supabase após recarregar");
await p.getByRole("button", { name: /^Entregue$/ }).click();
await p.getByRole("button", { name: "Encerrar saída" }).click();
await p.waitForURL("**/resumo"); step("saída encerrada");
await p.screenshot({ path: `${S}/real-summary.png`, fullPage: true });

// outro restaurante tenta acessar
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
const q = await ctx2.newPage();
await q.goto(URL0 + "/entrar");
await q.getByLabel("E-mail").fill("outro@pizzaria.test"); await q.getByLabel("Senha").fill("senha-forte-123");
await q.getByRole("button", { name: "Entrar" }).click();
await q.waitForURL("**/configurar");
await q.getByRole("button", { name: /Sou restaurante/ }).click();
await q.getByLabel(/Como aparece/).fill("Pizzaria B"); await q.getByRole("button", { name: "Continuar" }).click();
await q.getByLabel("Nome da base").waitFor();
await q.goto(URL0 + "/app");
await q.goto(batchUrl);
await q.getByText("Acesso negado ou lote inexistente").waitFor({ timeout: 15000 }); step("outro restaurante: acesso negado ao lote");

// entregador entra com convite
const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 } });
const d = await ctx3.newPage();
await d.goto(URL0 + "/entrar");
await d.getByLabel("E-mail").fill("moto@entregador.test"); await d.getByLabel("Senha").fill("senha-forte-123");
await d.getByRole("button", { name: "Entrar" }).click();
await d.waitForURL("**/configurar");
await d.getByRole("button", { name: /Sou entregador/ }).click();
await d.getByLabel("Código de convite").fill(code);
await d.getByRole("button", { name: "Entrar na equipe" }).click();
await d.waitForURL(URL0 + "/app");
await d.goto(URL0 + "/app/perfil");
await d.getByText("Base e cidade definidas pelo restaurante.").waitFor(); step("entregador herdou a base do restaurante");
await d.goto(batchUrl);
await d.getByText("Acesso negado ou lote inexistente").waitFor({ timeout: 15000 }); step("entregador não vê lote não atribuído");
await d.getByRole("link", { name: "Voltar ao início" }).click();
await d.goto(URL0 + "/app/perfil"); await d.getByRole("button", { name: /Sair da conta/ }).click();
await d.waitForURL("**/entrar");
const left = await d.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rp:") || k.startsWith("sb-")));
console.log("  chaves locais após sair:", left); step("logout limpa dados locais");
await b.close();
