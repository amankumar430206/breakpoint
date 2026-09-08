# README demo GIF — scene to capture

The hero GIF can't be auto-recorded. Capture this ~8-second scene at ~1280×720,
then drop it in as `docs/demo.gif` and reference it at the top of `README.md`.

1. Open `/sandbox/?preset=url-shortener` (or load **url-shortener** from Presets).
2. Hit **Play**. Let it settle for ~2 s — everything green.
3. Select the **load balancer** node and delete it (Del / context-menu → Delete).
4. Watch: the API server card **reddens and pulses**, its ρ shoots past 1, the
   p99 sparkline goes vertical, the bottleneck panel names it.
5. Stop.

Keep it tight — the point is "change one thing, watch it break in real time".

Recommended tools: [`vhs`](https://github.com/charmbracelet/vhs) for a scripted
run, or any screen recorder → `gifski` for a small, sharp GIF (< 3 MB).
