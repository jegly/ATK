# Proprietary — DO NOT publish to GitHub

These are the closed-source parts of ATK (the **Logcat visual map** / live system
telemetry engine). They build into the shipped binary (obfuscated JS + native Go),
but their **source is never committed/pushed** to the public repo. `.gitignore`
keeps them untracked.

## Live files that are PROPRIETARY (kept in their build locations, gitignored)
- `frontend/src/lib/logcatgraph.ts` — the data engine (graph model, layout, particles, decay, tree/geometry placement)
- `frontend/src/components/views/LogcatMap.tsx` — the Canvas / Neon / 3D renderers + UI
- `backend_logcatpatterns.go` — the relationship-mining heuristics (ported from TS to native Go)

## Shared files that contain map *hooks* (these DO ship publicly)
- `backend_logcat.go` — calls `lcpExtractRefs`/`lcpExtractMentions`, `LogRef` struct
- `frontend/src/lib/types.ts` — `LogRef` / `RefKind` + `LogcatLine.refs/mentions`
- `frontend/src/components/views/ViewLogcat.tsx` — Text/Map toggle + mounts `<LogcatMap>`
- `frontend/vite.config.ts` — obfuscation config (lists the map files)
- `frontend/package.json` — `pixi.js`, `three` deps
- `main.go` — `ensureWebGLEnv`
> A public clone without these files **will not compile** (`backend_logcat.go`
> calls `lcpExtractRefs`/`LogRef`; `ViewLogcat.tsx` imports `<LogcatMap>`).
> Graceful map-less degradation is still a future task.

## How releases are built
**Locally, by hand.** There is no GitHub Actions auto-build — a public-repo CI
can't compile the map (these files aren't in the repo) and we don't want a
private repo / token setup. Build the `.deb` on your own machine (where the full
source lives) and upload it to the GitHub Release manually. Linux only.

## backups/
Original source of anything ported to another language, kept for future work.
- `backups/logcatpatterns.ts` — the pre-Go-port TS of the relationship miner.
  **Convention:** whenever we port TS → Go, drop the original TS here so we never
  lose the readable version. If you change the Go, mirror the logic back here.
