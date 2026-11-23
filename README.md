# RotaPronta

Aplicativo web (PWA) para restaurantes, deliveries e motoboys brasileiros: **fotografe várias notinhas juntas, resolva só os endereços duvidosos e saia com a sequência de entregas organizada**, com mapa, distância e duração estimadas, navegação no Google Maps com um toque e registro de cada entrega — inclusive sem sinal.

> Nome provisório. Interface em português do Brasil, horários em `America/Sao_Paulo`, foco em celular e painel confortável no desktop.

## Como rodar

```bash
npm install
npm run dev            # http://localhost:5173
```

Sem nenhuma variável configurada o app abre e **a demonstração funciona por completo** (botão “Experimentar com dados fictícios” na página inicial). Para contas reais, configure o Supabase (abaixo).

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | verificação de tipos + build de produção (PWA com service worker) |
| `npm run preview` | serve o build (para testar instalação/offline) |
| `npm run typecheck` / `npm run lint` | TypeScript e ESLint |
| `npm test` | testes unitários e de integração dos adaptadores (Vitest) |
| `npm run test:db` | migração + testes de RLS/isolamento num Postgres local (`DATABASE_URL`) |
| `npm run test:e2e` | ponta a ponta no navegador (Playwright, modo demonstração) |
| `npm run demo:assets` | regenera as fotos de exemplo e os ícones |

## Arquitetura

```
src/                         React 19 + TypeScript + Vite 8 + Tailwind 4 (componentes no estilo shadcn/ui + Radix)
  data/backend.ts            contrato da camada de dados (o app só fala com ele)
  data/supabaseBackend.ts    implementação real: Auth, Postgres com RLS, Storage privado, função rota-api
  data/demoBackend.ts        demonstração local (dados fictícios, simulações identificadas)
  data/offlineQueue.ts       fila local de registros de entrega + cache da rota ativa
  pages/                     telas (início, captura, processamento, endereços, rota, entrega, resumo, histórico, perfil)
supabase/
  migrations/                esquema, RLS, gatilhos, RPCs e bucket privado
  functions/rota-api/        Edge Function (Deno): leitura, localização, rota, exclusão, retenção
  functions/_shared/core/    regras de negócio puras, usadas pelo app e pelo servidor
  functions/_shared/providers/ adaptadores reais: Claude (visão), Google Geocoding, Google Routes
tests/unit · tests/db · tests/e2e
```

### Separação de responsabilidades
- **Extrair** — `ReceiptExtractor` (`core/receiptExtractor.ts`). Implementação real: `AnthropicReceiptExtractor` (Claude `claude-opus-5-5`, visão + saída estruturada em JSON Schema, fallback de recusa no servidor). A resposta é validada com Zod e normalizada (`core/extraction.ts`): nunca inventa número, CEP, telefone ou coordenadas; cidade ausente usa a da base **marcada como inferida**; cabeçalho do restaurante não vira entrega; texto da imagem é tratado como dado.
- **Geocodificar** — `GeocodingProvider` (`core/geocoding.ts`). Real: Google Geocoding API. Classifica porta (ROOFTOP/interpolado) × aproximado (centro de rua/bairro/cidade), número não confirmado, correspondência parcial, múltiplos candidatos e fora da área. Procedência gravada (`provider`, `candidate_choice`, `manual_pin`).
- **Otimizar** — `RoutingProvider` (`core/planning.ts`). Real: Google Routes API — `computeRouteMatrix` (TWO_WHEELER, TRAFFIC_AWARE, até 25×25 = 625 elementos) e `computeRoutes` (desenho, até 25 intermediários por chamada, encadeado). A ordem é decidida pelo **nosso** otimizador (`core/optimizer.ts`) sobre a matriz assimétrica: Held-Karp exato até 15 paradas e heurística multi-partida com Or-opt/2-opt/troca acima disso, sempre recalculando o custo no sentido percorrido. Rota **aberta** (o algoritmo escolhe a última parada) ou **com retorno**. Não usamos `optimizeWaypointOrder` porque ele fixa origem e destino. Se o perfil de moto não for aceito, recalcula com DRIVE e informa; nunca bicicleta.
- **Navegar** — Maps URLs oficiais (`core/mapsUrl.ts`): `https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=two-wheeler&dir_action=navigate`, destino verificado e parâmetros codificados. Link com várias paradas só aparece quando cabe com segurança (até 3 intermediárias e 2.048 caracteres).

### Dados e acesso
Organizações (restaurante ou entregador autônomo), membros e papéis (`owner`, `manager`, `driver`), bases, lotes, imagens privadas, pedidos, rotas versionadas, paradas e registros de entrega (`stop_events`, somente inclusão, id gerado no aparelho).

- RLS em todas as tabelas; gestor vê todos os lotes da organização, entregador só os que criou ou recebeu.
- `org_id` dos registros filhos é **sempre** copiado do lote por gatilho (valor enviado pelo cliente é ignorado); pedido/rota/evento de outro lote é recusado.
- Bucket `receipts` privado, caminho `{org}/{lote}/{arquivo}`, URLs assinadas de 5 min.
- Chaves de OCR e Google ficam só na Edge Function; a função valida o JWT e acessa dados com o cliente do usuário (RLS aplicada). A chave de serviço só toca cache de matrizes, contadores de uso, log operacional e retenção.
- Idempotência: foto única por `sha256` no lote; pedido único por `(imagem, posição)`; imagem “reservada” antes da leitura (não lê duas vezes); localização ignorada se o texto não mudou; matriz em cache por 30 min; registros de entrega com `on conflict do nothing`.
- Logs operacionais só com ids e contagens. Exclusão de fotos ou do lote inteiro na tela de resumo; ação `retention` para agendar a limpeza automática.

### PWA e conexão instável
Manifest, ícones e service worker (Workbox, só arquivos do app — nenhuma resposta de API é guardada pelo SW). A rota ativa fica em cache local para consulta; “Entregue”, “Voltar depois”, “Não foi possível entregar” e “Desfazer” funcionam offline e sincronizam ao reconectar sem duplicar. Leitura, localização e novos cálculos exigem internet e o app diz isso. Ao sair da conta, dados locais são apagados.

## Configuração real

1. Crie um projeto Supabase **de desenvolvimento** e aplique a migração:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase functions deploy rota-api
   npx supabase secrets set ANTHROPIC_API_KEY=... GOOGLE_MAPS_SERVER_KEY=... ALLOWED_ORIGINS=https://seu-dominio
   ```
2. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Google Cloud: ative **Geocoding API** e **Routes API** para a chave de servidor (restrita por API). Para o mapa com ruas, uma chave separada só com **Maps JavaScript API**, restrita por domínio, em `VITE_GOOGLE_MAPS_BROWSER_KEY`. Resultados da Routes API só são desenhados sobre mapa Google; sem a chave do navegador, o app mostra o mapa ilustrativo sem a geometria do Google.
4. Auth: em *URL Configuration* adicione `https://seu-dominio/redefinir-senha` e `/app` aos redirects.
5. Retenção (opcional): agende `POST /functions/v1/rota-api` com `{"action":"retention"}` e o cabeçalho `x-cron-secret` (variável `CRON_SECRET`).

Sem `ANTHROPIC_API_KEY`, fotos são guardadas mas a leitura responde “não configurada” e o app oferece inclusão manual — nunca preenche pedidos fictícios. Sem `GOOGLE_MAPS_SERVER_KEY`, a localização pede ajuste do pino e a rota usa **simulação em linha reta identificada** na tela.

## Demonstração

Botão “Experimentar com dados fictícios”. Tudo fica no navegador, separado dos dados reais, com faixa “Modo demonstração”.
- Restaurante “Cantina Bela Vista (fictícia)”, entregador fictício e lotes de exemplo (um concluído, um em andamento).
- Duas fotos de exemplo (`public/demo/`), cada uma vinculada à sua resposta simulada pelo hash do arquivo: 5 notinhas lado a lado + 3 notinhas (uma repetida). Inclui número ilegível, dois pedidos no mesmo prédio e o cabeçalho do restaurante.
- Foto qualquer enviada na demonstração **não** recebe esses pedidos: aparece “leitura indisponível” e a inclusão manual.
- Localização fictícia só para os endereços de exemplo; rota por simulação em linha reta, identificada.

## Verificações

| Verificação | Como | Situação |
|---|---|---|
| 5 notinhas numa foto → 5 pedidos com origem (índice e região) | `tests/unit/extraction.test.ts`, E2E | ✅ |
| Várias fotos no mesmo lote sem duplicar por reenvio | unique `sha256` (RLS test), E2E, unit de repetidos | ✅ |
| Endereço incompleto/ambíguo exige resolução | `geocoding.test.ts`, E2E (botão bloqueado) | ✅ |
| Dois pedidos no mesmo endereço continuam dois | `planning.test.ts`, RLS test, E2E | ✅ |
| Matriz assimétrica tratada corretamente | `optimizer.test.ts` (força bruta × exato × heurística) | ✅ |
| Rota aberta e com retorno preservam todas as entregas | `planning.test.ts` | ✅ |
| Link do Maps correto, com acentos e caracteres especiais | `mapsUrl.test.ts`, E2E | ✅ |
| Registrar, recarregar e voltar do Maps preserva progresso | `progress.test.ts`, E2E | ✅ |
| Falhas de rede/OCR/rota recuperáveis sem duplicar | adaptadores (HTTP simulado), E2E offline, idempotência no banco | ✅ (simulado) |
| Usuário não acessa pedidos/imagens de outro restaurante | `npm run test:db` (28 verificações em Postgres 16 com emulação do Supabase) | ✅ |
| Telas em 360, 390, 768 e 1440 px | `tests/e2e/responsive.spec.ts` (sem rolagem horizontal, toques ≥ 48 px) | ✅ (Chromium) |

Testes com mock **não** comprovam integração externa. Veja abaixo o que foi verificado com serviços reais.

### Teste do modo real (Supabase local)
```bash
npx supabase start                       # Postgres 17, Auth, Storage, API (Docker)
# crie os usuários de teste pela API admin (email_confirm=true) — ver scripts/e2e-real-supabase.mjs
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<anon> npx vite --port 5175
APP_URL=http://localhost:5175 node scripts/e2e-real-supabase.mjs
```
O script percorre: login → configuração do restaurante (base pelo GPS do navegador) → convite → upload de foto no storage privado → leitura sem chave (“não configurada”, nenhum pedido inventado) → inclusão manual → pino no mapa → rota (simulação identificada) → entregas registradas e preservadas após recarregar → encerramento → outro restaurante recebe “acesso negado” → entregador entra com convite, herda a base e não vê lote não atribuído → sair apaga os dados locais.
Se o container de funções não conseguir baixar pacotes npm (proxy corporativo), rode a função com o Deno local e aponte o app com `VITE_SUPABASE_FUNCTIONS_URL`:
```bash
cd supabase/functions/rota-api && deno run --allow-net --allow-env --env-file=<arquivo com SUPABASE_URL/ANON/SERVICE_ROLE> index.ts
```

## Integrações

| Integração | Situação |
|---|---|
| Supabase (Auth, Postgres/RLS, Storage, Edge Function) | **Verificado localmente** com Supabase CLI 3.2.0 (Postgres 17, Auth, Storage) e a função executada em Deno 2.9; falta criar o projeto de desenvolvimento na nuvem |
| Claude (leitura das notinhas) | Adaptador implementado e testado com HTTP simulado; **pendente chave** `ANTHROPIC_API_KEY` |
| Google Geocoding API | Adaptador implementado e testado com HTTP simulado; **pendente chave** |
| Google Routes API (matriz + percurso, moto) | Adaptador implementado conforme os protos oficiais `google.maps.routing.v2`; **pendente chave** |
| Maps JavaScript API (mapa com ruas) | Componente implementado; **pendente chave pública restrita** |
| Google Maps URLs | Implementado; não requer chave |

Observações: rotas de moto (TWO_WHEELER) estão em beta no Google e o aviso obrigatório é exibido; o Maps pode exibir prévia em vez de iniciar a navegação e pode seguir outro caminho — a ordem e as conclusões ficam no RotaPronta.
