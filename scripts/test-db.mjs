// Testes de migração e isolamento (RLS) num Postgres local com emulação mínima do Supabase.
// Uso: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbName = "rotapronta_rls_test";

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
await admin.end();

const url = new URL(adminUrl);
url.pathname = `/${dbName}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query(readFileSync("tests/db/supabase_stubs.sql", "utf8"));
for (const f of readdirSync("supabase/migrations").sort()) {
  await db.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  console.log(`✓ migração aplicada: ${f}`);
}

const users = Object.fromEntries(["ownerA", "driverA", "driverA2", "ownerB", "soloC"].map((k) => [k, randomUUID()]));
for (const [k, id] of Object.entries(users)) {
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, `${k}@example.test`, { display_name: k }]);
}

/** Executa como usuário autenticado dentro de uma transação revertida ao final. */
async function as(user, fn) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await db.query("set local role authenticated");
    return await fn((q, p) => db.query(q, p));
  } finally {
    await db.query("rollback");
  }
}
/** Mesmo que `as`, mas confirma as alterações. */
async function asCommit(user, fn) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await db.query("set local role authenticated");
    const r = await fn((q, p) => db.query(q, p));
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
async function expectDenied(promise, label) {
  try {
    await promise;
  } catch (e) {
    console.log(`✓ negado: ${label} (${e.code})`);
    return;
  }
  throw new Error(`deveria ter sido negado: ${label}`);
}
const pass = (m) => console.log(`✓ ${m}`);

// ── Restaurante A com dono e dois entregadores; restaurante B; entregador autônomo C
const orgA = await asCommit(users.ownerA, async (q) => (await q("select public.create_organization('Cantina A', 'restaurant') id")).rows[0].id);
const orgB = await asCommit(users.ownerB, async (q) => (await q("select public.create_organization('Pizzaria B', 'restaurant') id")).rows[0].id);
const orgC = await asCommit(users.soloC, async (q) => (await q("select public.create_organization('Moto C', 'solo') id")).rows[0].id);
const code = await asCommit(users.ownerA, async (q) => (await q("select public.create_invite($1) code", [orgA])).rows[0].code);
await asCommit(users.driverA, async (q) => q("select public.accept_invite($1)", [code]));
await expectDenied(asCommit(users.driverA2, async (q) => q("select public.accept_invite($1)", [code])), "convite reutilizado");
const code2 = await asCommit(users.ownerA, async (q) => (await q("select public.create_invite($1) code", [orgA])).rows[0].code);
await asCommit(users.driverA2, async (q) => q("select public.accept_invite($1)", [code2]));
pass("organizações e convites criados");

await expectDenied(asCommit(users.driverA, async (q) => q("select public.create_invite($1)", [orgA])), "entregador criando convite");

const baseA = await asCommit(users.ownerA, async (q) => (await q(
  "insert into public.bases (org_id, name, address_line, city, uf, lat, lng, location_provenance) values ($1,'Cantina A','Rua X, 1','São Paulo','SP',-23.58,-46.63,'provider') returning id", [orgA])).rows[0].id);
await expectDenied(asCommit(users.driverA, async (q) => q(
  "insert into public.bases (org_id, name, address_line, city, uf, lat, lng, location_provenance) values ($1,'x','Rua Y, 2','São Paulo','SP',-23.5,-46.6,'provider')", [orgA])), "entregador alterando base do restaurante");

// ── Lotes
const batchA1 = await asCommit(users.ownerA, async (q) => (await q(
  "insert into public.batches (org_id, base_id, assigned_driver_id) values ($1,$2,$3) returning id", [orgA, baseA, users.driverA])).rows[0].id);
const batchA2 = await asCommit(users.driverA2, async (q) => (await q(
  "insert into public.batches (org_id, base_id) values ($1,$2) returning id", [orgA, baseA])).rows[0].id);
await expectDenied(asCommit(users.driverA2, async (q) => q(
  "insert into public.batches (org_id, assigned_driver_id) values ($1,$2)", [orgA, users.driverA])), "entregador atribuindo lote a outro");
await expectDenied(asCommit(users.ownerA, async (q) => q(
  "insert into public.batches (org_id, assigned_driver_id) values ($1,$2)", [orgA, users.ownerB])), "atribuir a quem não é membro");
await expectDenied(asCommit(users.ownerB, async (q) => q(
  "insert into public.batches (org_id) values ($1)", [orgA])), "criar lote em organização alheia (org_id forjado)");
await expectDenied(asCommit(users.ownerB, async (q) => q(
  "insert into public.batches (org_id, base_id) values ($1,$2)", [orgB, baseA])), "usar base de outra organização");

// imagem + pedidos: org_id enviado pelo cliente é ignorado e substituído pelo do lote
const sha = "a".repeat(64);
const img = await asCommit(users.driverA, async (q) => (await q(
  "insert into public.batch_images (batch_id, org_id, storage_path, sha256, bytes, mime) values ($1,$2,$3,$4,1000,'image/jpeg') returning id, org_id",
  [batchA1, orgB, `${orgA}/${batchA1}/img1.jpg`, sha])).rows[0]);
assert.equal(img.org_id, orgA);
pass("org_id forjado pelo cliente substituído pelo da organização do lote");
await expectDenied(asCommit(users.driverA, async (q) => q(
  "insert into public.batch_images (batch_id, storage_path, sha256, bytes, mime) values ($1,$2,$3,1000,'image/jpeg')",
  [batchA1, `${orgA}/${batchA1}/img1-again.jpg`, sha])), "reenvio da mesma imagem no lote (sha256 duplicado)");

const [o1, o2] = await asCommit(users.driverA, async (q) => (await q(
  `insert into public.orders (batch_id, source_image_id, source_index, origin, street, number, status, lat, lng, phone)
   values ($1,$2,0,'ocr','Rua Vergueiro','3185','ready',-23.59,-46.63,'11988887777'),
          ($1,$2,1,'ocr','Rua Vergueiro','3185','ready',-23.59,-46.63,null) returning id`, [batchA1, img.id])).rows.map((r) => r.id));
await expectDenied(asCommit(users.driverA, async (q) => q(
  "insert into public.orders (batch_id, source_image_id, source_index, origin, street) values ($1,$2,0,'ocr','Rua X')", [batchA1, img.id])),
  "repetir extração da mesma notinha (source_image_id, source_index)");
await asCommit(users.driverA, async (q) => {
  const r = await q("select count(*)::int n from public.orders where batch_id = $1", [batchA1]);
  assert.equal(r.rows[0].n, 2);
});
pass("dois pedidos no mesmo endereço persistem como dois registros");

// ── Isolamento de leitura
await as(users.ownerB, async (q) => {
  assert.equal((await q("select count(*)::int n from public.orders")).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.batches")).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.batch_images")).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.bases where org_id = $1", [orgA])).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.organizations where id = $1", [orgA])).rows[0].n, 0);
  const upd = await q("update public.orders set street = 'hack' where batch_id = $1", [batchA1]);
  assert.equal(upd.rowCount, 0);
  const del = await q("delete from public.batches where id = $1", [batchA1]);
  assert.equal(del.rowCount, 0);
});
pass("restaurante B não lê nem altera pedidos, imagens, lotes ou bases do restaurante A");

await as(users.soloC, async (q) => {
  assert.equal((await q("select count(*)::int n from public.orders")).rows[0].n, 0);
});
pass("entregador autônomo não vê dados de restaurantes");

await as(users.driverA2, async (q) => {
  assert.equal((await q("select count(*)::int n from public.batches where id = $1", [batchA1])).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.orders where batch_id = $1", [batchA1])).rows[0].n, 0);
  assert.equal((await q("select count(*)::int n from public.batches where id = $1", [batchA2])).rows[0].n, 1);
});
pass("entregador só acessa lotes que criou ou recebeu");

await as(users.ownerA, async (q) => {
  assert.equal((await q("select count(*)::int n from public.batches")).rows[0].n, 2);
});
pass("gestor do restaurante vê todos os lotes da organização");

// ── Storage privado
await asCommit(users.driverA, async (q) => q("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${orgA}/${batchA1}/img1.jpg`]));
await expectDenied(asCommit(users.ownerB, async (q) => q("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${orgA}/${batchA1}/evil.jpg`])), "enviar foto para pasta de outro restaurante");
await expectDenied(asCommit(users.driverA, async (q) => q("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [`${orgB}/${batchA1}/x.jpg`])), "caminho com org_id trocado");
await as(users.ownerB, async (q) => {
  assert.equal((await q("select count(*)::int n from storage.objects where bucket_id = 'receipts'")).rows[0].n, 0);
  assert.equal((await q("delete from storage.objects where bucket_id = 'receipts'")).rowCount, 0);
});
await as(users.driverA2, async (q) => {
  assert.equal((await q("select count(*)::int n from storage.objects where bucket_id = 'receipts'")).rows[0].n, 0);
});
await as(users.driverA, async (q) => {
  assert.equal((await q("select count(*)::int n from storage.objects where bucket_id = 'receipts'")).rows[0].n, 1);
});
pass("fotos privadas: só quem acessa o lote vê a imagem");

// ── Registros de entrega: idempotentes e somente inclusão
const ev = randomUUID();
await asCommit(users.driverA, async (q) => q(
  "insert into public.stop_events (id, batch_id, order_id, kind, occurred_at) values ($1,$2,$3,'delivered', now()) on conflict (id) do nothing", [ev, batchA1, o1]));
await asCommit(users.driverA, async (q) => q(
  "insert into public.stop_events (id, batch_id, order_id, kind, occurred_at) values ($1,$2,$3,'delivered', now()) on conflict (id) do nothing", [ev, batchA1, o1]));
await as(users.driverA, async (q) => {
  assert.equal((await q("select count(*)::int n from public.stop_events where order_id = $1", [o1])).rows[0].n, 1);
  assert.equal((await q("select status from public.batches where id = $1", [batchA1])).rows[0].status, "draft");
});
pass("reenvio da mesma conclusão não duplica");
await expectDenied(asCommit(users.driverA, async (q) => q("update public.stop_events set kind = 'failed' where id = $1", [ev])), "alterar registro de entrega");
await expectDenied(asCommit(users.ownerB, async (q) => q(
  "insert into public.stop_events (id, batch_id, order_id, kind, occurred_at) values ($1,$2,$3,'delivered', now())", [randomUUID(), batchA1, o2])), "registrar entrega em lote alheio");
await expectDenied(asCommit(users.driverA2, async (q) => q(
  "insert into public.stop_events (id, batch_id, order_id, kind, occurred_at) values ($1,$2,$3,'delivered', now())", [randomUUID(), batchA2, o2])), "registrar evento com pedido de outro lote");

// ── Perfis: só colegas de organização
await as(users.ownerB, async (q) => {
  assert.equal((await q("select count(*)::int n from public.profiles where user_id = $1", [users.driverA])).rows[0].n, 0);
});
await as(users.ownerA, async (q) => {
  assert.equal((await q("select count(*)::int n from public.org_members($1)", [orgA])).rows[0].n, 3);
  assert.equal((await q("select count(*)::int n from public.org_members($1)", [orgB])).rows[0].n, 0);
});
await expectDenied(asCommit(users.ownerB, async (q) => q("update public.profiles set active_org_id = $1 where user_id = $2", [orgA, users.ownerB])), "ativar organização da qual não é membro");
pass("perfis e lista de membros isolados por organização");

// ── Cache e logs inacessíveis ao cliente
await expectDenied(as(users.ownerA, async (q) => q("select * from public.matrix_cache")), "ler cache de matrizes pelo cliente");
await expectDenied(as(users.ownerA, async (q) => q("insert into public.ops_log (event) values ('x')")), "escrever log operacional pelo cliente");

// ── Exclusão do lote remove dados em cascata
await asCommit(users.ownerA, async (q) => q("delete from public.batches where id = $1", [batchA1]));
const left = await db.query("select (select count(*) from public.orders where batch_id = $1)::int o, (select count(*) from public.stop_events where batch_id = $1)::int e, (select count(*) from public.batch_images where batch_id = $1)::int i", [batchA1]);
assert.deepEqual(left.rows[0], { o: 0, e: 0, i: 0 });
pass("excluir o lote remove pedidos, imagens e registros");

// ── Excluir a conta de um entregador não apaga lotes nem registros do restaurante
await db.query("delete from auth.users where id = $1", [users.driverA2]);
const kept = await db.query("select created_by from public.batches where id = $1", [batchA2]);
assert.equal(kept.rowCount, 1);
assert.equal(kept.rows[0].created_by, null);
pass("excluir conta de usuário preserva os lotes da organização");

void orgC;
await db.end();
console.log("\nTodos os testes de banco/RLS passaram.");
