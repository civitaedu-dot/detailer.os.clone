# Vídeo de demonstração (motion graphics)

Gera um MP4 1920×1080 a partir das telas REAIS do modo demonstração.

```bash
npx vite --port 5173 &                     # app rodando
node scripts/video/capture.mjs             # captura as telas em scripts/video/shots
node scripts/video/render.mjs              # renderiza os quadros (30 fps)
ffmpeg -framerate 30 -i scripts/video/frames/%05d.jpg -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart video-demo/RotaPronta-demo.mp4
```
A animação está em `motion.html` (função `render(t)`); `preview.mjs 3.5 20` gera quadros avulsos para conferir.
