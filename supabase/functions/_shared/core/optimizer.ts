/**
 * Ordenação de paradas sobre uma matriz de custos (tempo pelas vias) possivelmente ASSIMÉTRICA:
 * custo[a][b] pode ser diferente de custo[b][a] (mão única, retornos, conversões).
 *
 * - Rota aberta: começa na origem e termina na última entrega (o algoritmo escolhe qual).
 * - Rota fechada: começa na origem e termina no ponto de retorno (base).
 *
 * Até EXACT_LIMIT paradas usa programação dinâmica (Held-Karp) sobre a matriz recebida;
 * acima disso, heurística com várias partidas + melhoria local que sempre recalcula o custo
 * no sentido percorrido. O resultado é "otimizado para a matriz estimada" — a matriz em si é
 * uma estimativa do fornecedor, então nunca anunciamos ótimo global real.
 */

export const UNREACHABLE = 1e9;
export const EXACT_LIMIT = 15;

export type SequenceProblem = {
  /** matriz quadrada de custos; use Infinity/null para trecho sem rota */
  cost: (number | null)[][];
  start: number;
  /** null = rota aberta */
  end: number | null;
  /** índices das paradas a visitar (sem start/end) */
  stops: number[];
};

export type SequenceResult = {
  order: number[];
  cost: number;
  method: "exact" | "heuristic" | "trivial";
  /** paradas que só puderam ser incluídas por trechos sem rota conhecida */
  unreachableLegs: Array<[number, number]>;
};

function c(m: SequenceProblem["cost"], a: number, b: number): number {
  const v = m[a]?.[b];
  return v === null || v === undefined || !Number.isFinite(v) ? UNREACHABLE : v;
}

export function pathCost(p: SequenceProblem, order: number[]): number {
  if (order.length === 0) return p.end === null ? 0 : c(p.cost, p.start, p.end);
  let total = c(p.cost, p.start, order[0]);
  for (let i = 0; i + 1 < order.length; i++) total += c(p.cost, order[i], order[i + 1]);
  if (p.end !== null) total += c(p.cost, order[order.length - 1], p.end);
  return total;
}

function unreachableLegs(p: SequenceProblem, order: number[]): Array<[number, number]> {
  const legs: Array<[number, number]> = [];
  const seq = [p.start, ...order, ...(p.end === null ? [] : [p.end])];
  for (let i = 0; i + 1 < seq.length; i++) if (c(p.cost, seq[i], seq[i + 1]) >= UNREACHABLE) legs.push([seq[i], seq[i + 1]]);
  return legs;
}

function validate(p: SequenceProblem) {
  const n = p.cost.length;
  if (!p.cost.every((row) => row.length === n)) throw new Error("Matriz de custos precisa ser quadrada.");
  const all = [p.start, ...p.stops, ...(p.end === null ? [] : [p.end])];
  if (all.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error("Índice fora da matriz.");
  if (new Set(p.stops).size !== p.stops.length) throw new Error("Paradas repetidas no problema.");
}

/** Held-Karp exato para o caminho com início fixo e fim fixo ou livre. */
export function solveExact(p: SequenceProblem): SequenceResult {
  validate(p);
  const k = p.stops.length;
  if (k === 0) return { order: [], cost: pathCost(p, []), method: "trivial", unreachableLegs: [] };
  if (k > EXACT_LIMIT + 2) throw new Error("Muitas paradas para o método exato.");
  const S = p.stops;
  const full = (1 << k) - 1;
  const dp = new Float64Array((1 << k) * k).fill(Infinity);
  const parent = new Int8Array((1 << k) * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = c(p.cost, p.start, S[j]);
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * k + j];
      if (cur === Infinity) continue;
      for (let nx = 0; nx < k; nx++) {
        if (mask & (1 << nx)) continue;
        const nm = mask | (1 << nx);
        const v = cur + c(p.cost, S[j], S[nx]);
        if (v < dp[nm * k + nx]) {
          dp[nm * k + nx] = v;
          parent[nm * k + nx] = j;
        }
      }
    }
  }
  let best = Infinity;
  let last = -1;
  for (let j = 0; j < k; j++) {
    const v = dp[full * k + j] + (p.end === null ? 0 : c(p.cost, S[j], p.end));
    if (v < best) { best = v; last = j; }
  }
  const order: number[] = [];
  let mask = full;
  let j = last;
  while (j !== -1) {
    order.push(S[j]);
    const pj = parent[mask * k + j];
    mask &= ~(1 << j);
    j = pj;
  }
  order.reverse();
  return { order, cost: best, method: "exact", unreachableLegs: unreachableLegs(p, order) };
}

function nearestNeighbor(p: SequenceProblem, first: number): number[] {
  const left = new Set(p.stops);
  const order = [first];
  left.delete(first);
  while (left.size) {
    const from = order[order.length - 1];
    let best = -1, bestV = Infinity;
    for (const s of left) {
      const v = c(p.cost, from, s);
      if (v < bestV) { bestV = v; best = s; }
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

/** Melhoria local: relocação de segmentos (Or-opt 1..3), 2-opt com inversão e trocas. */
export function improve(p: SequenceProblem, initial: number[]): number[] {
  let order = initial.slice();
  let best = pathCost(p, order);
  const n = order.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    // Or-opt: mover segmento [i, i+len) para outra posição (sem inverter — sentido importa)
    for (let len = 1; len <= Math.min(3, n - 1) && !improved; len++) {
      for (let i = 0; i + len <= n && !improved; i++) {
        const seg = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let pos = 0; pos <= rest.length; pos++) {
          if (pos === i) continue;
          const cand = [...rest.slice(0, pos), ...seg, ...rest.slice(pos)];
          const v = pathCost(p, cand);
          if (v + 1e-9 < best) { best = v; order = cand; improved = true; break; }
        }
      }
    }
    // 2-opt: inverte trecho; o custo é recalculado no novo sentido (assimetria)
    for (let i = 0; i < n - 1 && !improved; i++) {
      for (let j = i + 1; j < n && !improved; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const v = pathCost(p, cand);
        if (v + 1e-9 < best) { best = v; order = cand; improved = true; }
      }
    }
    // troca de duas paradas
    for (let i = 0; i < n - 1 && !improved; i++) {
      for (let j = i + 1; j < n && !improved; j++) {
        const cand = order.slice();
        [cand[i], cand[j]] = [cand[j], cand[i]];
        const v = pathCost(p, cand);
        if (v + 1e-9 < best) { best = v; order = cand; improved = true; }
      }
    }
  }
  return order;
}

export function solveHeuristic(p: SequenceProblem): SequenceResult {
  validate(p);
  if (p.stops.length === 0) return { order: [], cost: pathCost(p, []), method: "trivial", unreachableLegs: [] };
  let bestOrder: number[] = [];
  let bestCost = Infinity;
  for (const first of p.stops) {
    const o = improve(p, nearestNeighbor(p, first));
    const v = pathCost(p, o);
    if (v < bestCost) { bestCost = v; bestOrder = o; }
  }
  return { order: bestOrder, cost: bestCost, method: "heuristic", unreachableLegs: unreachableLegs(p, bestOrder) };
}

export function solveSequence(p: SequenceProblem): SequenceResult {
  return p.stops.length <= EXACT_LIMIT ? solveExact(p) : solveHeuristic(p);
}
