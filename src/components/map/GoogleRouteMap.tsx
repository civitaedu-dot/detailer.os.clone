import { AdvancedMarker, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import { env } from "@/lib/env.ts";
import { cn } from "@/lib/utils.ts";
import { STOP_COLORS, type RouteMapProps } from "./types.ts";

function FitBounds({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (!map || !points.length) return;
    const b = new google.maps.LatLngBounds();
    points.forEach((p) => b.extend(p));
    map.fitBounds(b, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Mapa Google (Maps JavaScript API) com o percurso calculado pela Routes API. */
export function GoogleRouteMap({ origin, end, stops, path, encodedPolylines, pin, onPinChange, onStopClick, className, ariaLabel }: RouteMapProps) {
  const all = [...stops, ...(origin ? [origin] : []), ...(end ? [end] : []), ...(pin ? [pin] : [])];
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line", className)} role="region" aria-label={ariaLabel}>
      <APIProvider apiKey={env.mapsBrowserKey} language="pt-BR" region="BR">
        <Map mapId={env.mapsMapId} defaultCenter={all[0] ?? { lat: -23.55, lng: -46.63 }} defaultZoom={13} gestureHandling="greedy"
          disableDefaultUI clickableIcons={false} className="h-full w-full"
          onClick={(e) => { if (onPinChange && e.detail.latLng) onPinChange(e.detail.latLng); }}>
          <FitBounds points={all} />
          {encodedPolylines?.length
            ? encodedPolylines.map((p, i) => <Polyline key={i} encodedPath={p} strokeColor="#0d8a3d" strokeWeight={6} strokeOpacity={0.9} />)
            : path && path.length > 1 && <Polyline path={path} strokeColor="#1f2421" strokeOpacity={0.5} strokeWeight={4} />}
          {origin && (
            <AdvancedMarker position={origin} title="Origem">
              <div className="grid size-9 place-items-center rounded-lg bg-graphite text-[11px] font-bold text-lime">SAÍDA</div>
            </AdvancedMarker>
          )}
          {stops.map((s) => {
            const c = STOP_COLORS[s.state];
            return (
              <AdvancedMarker key={s.id} position={s} title={s.title} onClick={onStopClick ? () => onStopClick(s.id) : undefined}>
                <div className="grid size-9 place-items-center rounded-full border-[3px] text-[15px] font-extrabold shadow" style={{ background: c.fill, color: c.text, borderColor: c.ring }}>{s.label}</div>
              </AdvancedMarker>
            );
          })}
          {pin && (
            <AdvancedMarker position={pin} draggable={!!onPinChange} onDragEnd={(e) => { if (e.latLng && onPinChange) onPinChange({ lat: e.latLng.lat(), lng: e.latLng.lng() }); }} title="Ponto ajustado">
              <div className="size-6 rounded-full border-4 border-white bg-danger shadow" />
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
