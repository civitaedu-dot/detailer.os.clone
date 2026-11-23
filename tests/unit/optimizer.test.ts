import { describe, expect, it } from "vitest";
import { improve, pathCost, solveExact, solveHeuristic, solveSequence, type SequenceProblem } from "@core/optimizer.ts";

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
function bruteForce(p: SequenceProblem) {
  let best = Infinity, order: number[] = [];
  for (const perm of permutations(p.stops)) { const v = pathCost(p, perm); if (v < best) { best = v; order = perm; } }
  return { best, order };
}
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randomAsymmetric(n: number, seed: number) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.round(60 + r() * 900))));
}

describe("otimizador com matriz assimétrica", () => {
  // A→B é rápido, B→A é lento (mão única). Uma ordenação simétrica erraria o sentido.
  const cost = [
    //  O    A    B    C
    [   0, 100, 900, 500],
    [ 900,   0,  50, 800],
    [ 100, 900,   0,  60],
    [ 120, 900, 900,   0],
  ];

  it("escolhe o sentido barato em rota aberta", () => {
    const r = solveExact({ cost, start: 0, end: null, stops: [1, 2, 3] });
    expect(r.order).toEqual([1, 2, 3]);
    expect(r.cost).toBe(100 + 50 + 60);
    // invertendo o sentido o custo explode — a assimetria foi considerada
    expect(pathCost({ cost, start: 0, end: null, stops: [1, 2, 3] }, [3, 2, 1])).toBe(500 + 900 + 900);
  });

  it("rota aberta escolhe a última parada (não fixa o fim arbitrariamente)", () => {
    const m = [
      [0, 10, 10, 10],
      [10, 0, 10, 500],
      [10, 10, 0, 10],
      [10, 500, 10, 0],
    ];
    const r = solveExact({ cost: m, start: 0, end: null, stops: [1, 2, 3] });
    expect(r.cost).toBe(30);
    expect([r.order[0], r.order[2]].sort()).toEqual([1, 3]);
  });

  it("rota com retorno inclui o custo de volta à base", () => {
    const r = solveExact({ cost, start: 0, end: 0, stops: [1, 2, 3] });
    const bf = bruteForce({ cost, start: 0, end: 0, stops: [1, 2, 3] });
    expect(r.cost).toBe(bf.best);
    expect(r.order).toEqual([1, 2, 3]); // 100+50+60+120 = 330
    expect(r.cost).toBe(330);
  });

  it("exato coincide com força bruta em matrizes assimétricas aleatórias (aberta e fechada)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const m = randomAsymmetric(8, seed);
      for (const end of [null, 0]) {
        const p = { cost: m, start: 0, end, stops: [1, 2, 3, 4, 5, 6, 7] };
        expect(solveExact(p).cost).toBe(bruteForce(p).best);
      }
    }
  });

  it("heurística com melhoria local avalia o sentido e fica próxima do exato", () => {
    let worst = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const m = randomAsymmetric(11, seed * 7);
      const p = { cost: m, start: 0, end: seed % 2 ? null : 0, stops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
      const h = solveHeuristic(p).cost, e = solveExact(p).cost;
      expect(h).toBeGreaterThanOrEqual(e);
      worst = Math.max(worst, h / e);
    }
    expect(worst).toBeLessThan(1.15);
  });

  it("melhoria local nunca piora a sequência inicial", () => {
    const m = randomAsymmetric(9, 99);
    const p = { cost: m, start: 0, end: null, stops: [1, 2, 3, 4, 5, 6, 7, 8] };
    const init = [8, 7, 6, 5, 4, 3, 2, 1];
    expect(pathCost(p, improve(p, init))).toBeLessThanOrEqual(pathCost(p, init));
  });

  it("15 paradas: todas preservadas, método exato", () => {
    const m = randomAsymmetric(16, 5);
    const stops = Array.from({ length: 15 }, (_, i) => i + 1);
    const r = solveSequence({ cost: m, start: 0, end: null, stops });
    expect(r.method).toBe("exact");
    expect([...r.order].sort((a, b) => a - b)).toEqual(stops);
  });

  it("trecho sem rota não remove a parada e é reportado", () => {
    const m: (number | null)[][] = [[0, 10, 10], [null, 0, null], [10, null, 0]];
    const r = solveExact({ cost: m, start: 0, end: null, stops: [1, 2] });
    expect(r.order.sort()).toEqual([1, 2]);
    expect(r.unreachableLegs.length).toBeGreaterThan(0);
  });
});
