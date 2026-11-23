import { lazy, Suspense } from "react";
import { useSession } from "@/data/session.tsx";
import { env } from "@/lib/env.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { SchematicMap } from "./SchematicMap.tsx";
import type { RouteMapProps } from "./types.ts";

const GoogleRouteMap = lazy(() => import("./GoogleRouteMap.tsx").then((m) => ({ default: m.GoogleRouteMap })));

/**
 * Escolhe o mapa: Google (modo real, com chave e conexão) ou ilustrativo (demonstração,
 * sem chave ou sem conexão). O ilustrativo nunca recebe a geometria do Google.
 */
export function RouteMap(props: RouteMapProps) {
  const { mode } = useSession();
  const online = useOnline();
  if (mode === "real" && env.mapsBrowserKey && online) {
    return (
      <Suspense fallback={<div className={props.className} />}>
        <GoogleRouteMap {...props} />
      </Suspense>
    );
  }
  return <SchematicMap {...props} encodedPolylines={undefined} />;
}
