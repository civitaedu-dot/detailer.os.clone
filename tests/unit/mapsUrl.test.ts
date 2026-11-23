import { describe, expect, it } from "vitest";
import { buildMultiStopUrl, buildNavigationUrl } from "@core/mapsUrl.ts";

describe("links do Google Maps", () => {
  it("usa api=1, destino verificado e navegação", () => {
    const url = new URL(buildNavigationUrl({ destination: { lat: -23.5880123, lng: -46.634 } }));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("-23.588012,-46.634000");
    expect(url.searchParams.get("dir_action")).toBe("navigate");
    expect(url.searchParams.get("travelmode")).toBe("two-wheeler");
    expect(url.searchParams.has("origin")).toBe(false); // Maps usa a localização atual
  });

  it("codifica acentos e caracteres especiais sem perder o destino", () => {
    const addr = "Rua São João, 45 – Ap. 12 & fundos #2, Jardim Ângela, São Paulo - SP";
    const raw = buildNavigationUrl({ destination: addr });
    expect(raw).not.toMatch(/[ ãÂ–#]/u);
    const url = new URL(raw);
    expect(url.searchParams.get("destination")).toBe(addr);
    expect(raw.split("&").length).toBe(4); // o "&" do endereço foi codificado
  });

  it("rejeita coordenadas inválidas", () => {
    expect(() => buildNavigationUrl({ destination: { lat: 0, lng: 0 } })).toThrow();
    expect(() => buildNavigationUrl({ destination: { lat: NaN, lng: 1 } })).toThrow();
  });

  it("link com várias paradas só existe quando cabe no limite seguro", () => {
    const s = [{ lat: -23.1, lng: -46.1 }, { lat: -23.2, lng: -46.2 }, { lat: -23.3, lng: -46.3 }, { lat: -23.4, lng: -46.4 }];
    const url = new URL(buildMultiStopUrl(s)!);
    expect(url.searchParams.get("destination")).toBe("-23.400000,-46.400000");
    expect(url.searchParams.get("waypoints")!.split("|")).toHaveLength(3);
    expect(buildMultiStopUrl([...s, { lat: -23.5, lng: -46.5 }])).toBeNull();
    expect(buildMultiStopUrl([s[0]])).toBeNull();
  });
});
