# ATK v1.2.0

Six new tools, a big theming pass, and a security cleanup.

## ✨ What's new
- 💿 **GSI Loader** — boot a Generic System Image two ways: **DSU** (temporary
  guest OS, no unlock/wipe, reboot to reclean) or a **permanent fastboot flash**
  (danger-gated, requires unlocked bootloader). Built-in compatibility pre-check
  (Treble, ABI, VNDK isolation) before either path.
- 🚀 **Intent Lab** — list an app's launchable (exported) activities straight from
  `dumpsys` and start them with one click, plus a free-form implicit-intent
  launcher. Reach hidden settings menus and internal screens that never show up
  on the launcher.
- 📥 **Firmware** — download and SHA-verify firmware images for a device
  codename, right from the app.
- 📱 **Screen Mirror** — scrcpy integration: start/stop mirroring and grab
  screenshots without leaving ATK.
- 🧙 **Magisk integration** — install Magisk, extract/patch boot images, and
  manage installed modules (list, toggle, remove) in one panel.
- 🕵️ **Privacy & Tracker Scanner** — scans an app's DEX bytecode for known
  tracker/analytics/ad SDK signatures, cross-references dangerous permissions,
  and derives a 0–100 privacy score with an A–F grade. Fully offline, no
  network calls.
- 🔒 **App Lock** — password-protect the app and gate destructive actions
  (flashing, permanent GSI install, etc.) behind a separate danger-unlock.
- 🔓 **Privileged uninstall, no root** — removes protected system apps via a
  bundled Android helper, with one-click restore.
- 🎨 **~14 new theme palettes** (Dracula, Catppuccin Mocha/Macchiato,
  Gruvbox Material, C64, Adventure Time, and more), on top of the existing
  Dark/Frappé/Latte.
- 🧹 **Debloater**: device packages with no UAD database match now show as
  **Unknown/Uncategorized** instead of silently disappearing from the list.
- 🔎 **APK Audit**: entry viewer now has syntax-highlighted code display instead
  of a plain text dump.

## 🔐 Security
- Fixed a path-injection issue in the local file viewer (CodeQL
  `go/path-injection`) — the resolved path is now validated as a real, regular
  file before being served.
- Dependency bumps: `golang.org/x/image` and `golang.org/x/net` (DoS fixes),
  `vite`, `postcss`, and `esbuild` (dev-tooling only, not shipped in the
  built app).

## 📦 Install (Linux)
**Debian / Ubuntu:**
```bash
sudo dpkg -i atk_1.2.0_amd64.deb
```
Requirements: `adb`, `fastboot`, `libgtk-3-0`, `libwebkit2gtk-4.1-0`
(`scrcpy` only needed for the Screen Mirror module).

Other distros: build from source — see the README.

> ⚠️ Linux only. No bundled binaries — ATK uses *your* system `adb`/`fastboot`/`scrcpy`.

## 🙏 Credits
Built on the open-source community — scrcpy, Magisk, Universal Android Debloater,
Wails, Lucide, and more. Full attributions and licenses are in the README. GPL-3.0.
