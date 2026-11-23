import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { Crop } from "@/lib/image.ts";

/** Recorte simples: arraste sobre a foto para marcar a área com as notinhas. */
export function CropSheet({ open, onOpenChange, src, initial, onApply }: {
  open: boolean; onOpenChange: (v: boolean) => void; src: string | null; initial: Crop | null; onApply: (c: Crop | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<Crop | null>(initial);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (open) setCrop(initial); }, [open, initial]);

  const pos = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = pos(e); setStart(p); setCrop({ x: p.x, y: p.y, width: 0, height: 0 }); };
  const onMove = (e: PointerEvent) => {
    if (!start) return;
    const p = pos(e);
    setCrop({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
  };
  const valid = crop && crop.width > 0.05 && crop.height > 0.05;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Recortar foto" description="Arraste sobre a foto para manter só a área das notinhas." wide
      footer={<div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => { onApply(null); onOpenChange(false); }}>Sem recorte</Button>
        <Button disabled={!valid} onClick={() => { onApply(valid ? crop : null); onOpenChange(false); }}>Aplicar recorte</Button>
      </div>}>
      {src && (
        <div ref={box} className="relative mx-auto w-fit touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => setStart(null)}>
          <img src={src} alt="Foto para recortar" className="max-h-[60dvh] w-auto rounded-lg" draggable={false} />
          {crop && crop.width > 0 && (
            <div className="pointer-events-none absolute border-[3px] border-lime shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />
          )}
        </div>
      )}
    </Sheet>
  );
}
