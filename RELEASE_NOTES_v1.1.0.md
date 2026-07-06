# ATK v1.1.0 — the Live System Map release

The all-in-one, OEM-style Android toolkit for power users, security researchers,
and bug hunters — now with a **first-of-its-kind real-time debugging engine**.

## ⭐ Headline — Live System Map
Turn the raw logcat firehose into a **live, interactive map of what your phone is
actually doing**. A real-time engine unifies system-level telemetry from many
subsystems into a single live relational model — processes, services, tags and
components become nodes; launches, crashes, ANRs, kills, signals and
graphics/audio events become edges; every event flows source → destination.

- 🌐 Multiple render modes — crisp 2D graph, neon flow view, 3D hierarchical tree
- 🧩 Layouts — force-directed, hub boxes, radial-by-importance, geometric
- 🌊 Trackable flows — follow individual events between subsystems
- 🚨 Auto-surfacing of crashes / ANRs / errors + your own keyword watch-rules
- 🎯 Focus tools — isolate a node, watchlist, severity/kind filters, timeline, baseline diff
- 🎥 Capture & export the packet stream for offline analysis

## ✨ What's new
- 📡 **Live System Map** — the flagship real-time visualization (above).
- 🧹 **Debloater database 2,157 → 5,362 packages** (Samsung, Xiaomi, Google + 11 more OEMs).
- 🔓 **Privileged uninstall of protected system apps — without root**, plus one-click **restore**.
- 🧰 **Utilities expanded to 631 one-click commands** across 50+ categories.
- 🔎 **APK Audit** — static security audit (perms, trackers, certs, CWE/MASVS rule findings) with an in-app APK explorer and **JSON · CSV · SARIF** export.
- 🎨 **Themes** — Dark, Catppuccin **Frappé** & **Latte**; configurable sidebar; dismissible safety banners.
- 📦 **Smarter package ops** — combined *Disable + Uninstall*, a *disabled* badge, and verify-then-escalate so removals actually stick.
- 🔌 **Fully offline-capable UI** — self-hosted fonts, no runtime CDN fetches.
- 🖼️ New app icon.

## 📦 Install (Linux)
**Debian / Ubuntu:**
```bash
sudo dpkg -i atk_1.1.0_amd64.deb
```
Requirements: `adb`, `fastboot`, `libgtk-3-0`, `libwebkit2gtk-4.1-0`
(`scrcpy` only needed for the Screen Mirror module).

Other distros: build from source — see the README.

> ⚠️ Linux only. No bundled binaries — ATK uses *your* system `adb`/`fastboot`/`scrcpy`.

## 🙏 Credits
Built on the open-source community — scrcpy, Magisk, Universal Android Debloater,
Wails, Lucide, and more. Full attributions and licenses are in the README. GPL-3.0.
