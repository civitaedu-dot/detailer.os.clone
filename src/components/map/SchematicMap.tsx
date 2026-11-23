import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { LatLng } from "@core/types.ts";
import { cn } from "@/lib/utils.ts";
import { STOP_COLORS, type RouteMapProps } from "./types.ts";

const W = 1000;
const H = 640;
const PAD = 70;

/**
 * Mapa ILUSTRATIVO (sem ruas): posiciona os pontos em escala e liga-os em linha reta na ordem.
 * Usado na demonstração e quando não há chave de mapa configurada. Funciona sem conexão.
 */
export function SchematicMap({ origin, end, stops, path, pin, onPinChange, onStopClick, className, ariaLabel }: RouteMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const proj = useMemo(() => {
    const pts: LatLng[] = [...stops, ...(origin ? [origin] : []), ...(end ? [end] : []), ...(pin ? [pin] : [])];
    if (!pts.length) pts.push({ lat: -23.55, lng: -46.63 });
    let minLat = Math.min(...pts.map((p) => p.lat)), maxLat = Math.max(...pts.map((p) => p.lat));
    let minLng = Math.min(...pts.map((p) => p.lng)), maxLng = Math.max(...pts.map((p) => p.lng));
    const minSpan = 0.006;
    if (maxLat - minLat < minSpan) { const c = (maxLat + minLat) / 2; minLat = c - minSpan / 2; maxLat = c + minSpan / 2; }
    if (maxLng - minLng < minSpan) { const c = (maxLng + minLng) / 2; minLng = c - minSpan / 2; maxLng = c + minSpan / 2; }
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = (maxLng - minLng) * k, spanY = maxLat - minLat;
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
    return {
      to: (p: LatLng) => ({ x: ox + (p.lng - minLng) * k * scale, y: oy + (maxLat - p.lat) * scale }),
      from: (x: number, y: number): LatLng => ({ lat: maxLat - (y - oy) / scale, lng: minLng + (x - ox) / (k * scale) }),
    };
  }, [stops, origin, end, pin]);

  const toSvg = (e: PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return proj.from(p.x, p.y);
  };

  const line = (path ?? []).map(proj.to).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const pinPt = pin ? proj.to(pin) : null;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border border-line bg-[#eef1ec]", className)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={cn("block min-h-0 w-full flex-1 touch-none select-none", onPinChange && "cursor-crosshair")}
        role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => { if (onPinChange) { setDragging(true); onPinChange(toSvg(e)); } }}
        onPointerMove={(e) => { if (dragging && onPinChange) onPinChange(toSvg(e)); }}
        onPointerUp={() => setDragging(false)} onPointerLeave={() => setDragging(false)}>
        <defs>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#dfe4dd" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        {line && <polyline points={line} fill="none" stroke="#1f2421" strokeWidth="5" strokeDasharray="14 10" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />}
        {origin && (() => { const p = proj.to(origin); return (
          <g aria-label="Origem"><rect x={p.x - 22} y={p.y - 22} width="44" height="44" rx="10" fill="#1f2421" /><path d={`M${p.x - 11} ${p.y + 2} L${p.x} ${p.y - 9} L${p.x + 11} ${p.y + 2} V${p.y + 11} H${p.x - 11} Z`} fill="#3ddc84" /></g>
        ); })()}
        {end && !(origin && end.lat === origin.lat && end.lng === origin.lng) && (() => { const p = proj.to(end); return (
          <g aria-label="Retorno"><rect x={p.x - 18} y={p.y - 18} width="36" height="36" rx="8" fill="#fff" stroke="#1f2421" strokeWidth="4" /></g>
        ); })()}
        {stops.map((s) => {
          const p = proj.to(s);
          const c = STOP_COLORS[s.state];
          const r = s.state === "next" ? 30 : 24;
          return (
            <g key={s.id} onClick={onStopClick ? () => onStopClick(s.id) : undefined} className={onStopClick ? "cursor-pointer" : undefined}>
              {s.state === "next" && <circle cx={p.x} cy={p.y} r={r + 10} fill={c.ring} opacity="0.35" />}
              <circle cx={p.x} cy={p.y} r={r} fill={c.fill} stroke={c.ring} strokeWidth="4" />
              <text x={p.x} y={p.y + 8} textAnchor="middle" fontSize={s.state === "next" ? 26 : 22} fontWeight="800" fill={c.text} fontFamily="Inter Variable, sans-serif">{s.label}</text>
              {s.state === "done" && <title>{`${s.title ?? s.label} — entregue`}</title>}
            </g>
          );
        })}
        {pinPt && (
          <g aria-label="Ponto ajustado">
            <path d={`M${pinPt.x} ${pinPt.y} c-14 -22 -24 -32 -24 -46 a24 24 0 1 1 48 0 c0 14 -10 24 -24 46z`} fill="#b42318" stroke="#fff" strokeWidth="4" />
            <circle cx={pinPt.x} cy={pinPt.y - 46} r="8" fill="#fff" />
          </g>
        )}
      </svg>
      <p className="shrink-0 border-t border-line bg-white/80 px-2.5 py-1 text-[12px] font-semibold text-ink-2">
        Mapa ilustrativo · sem ruas, linha reta entre pontos
      </p>
    </div>
  );
}
