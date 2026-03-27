# ATK — Android Toolkit

> An all-in-one ADB GUI for Android power users, security researchers, and bug hunters.

Built with [Wails v2](https://wails.io) (Go + React). Runs natively on Linux, macOS, and Windows. Uses **your system ADB** — no bundled binaries, no mystery executables.

---

## Features

### 📱 Dashboard
- Live device list with connection status
- Rich device info — model, Android version, build, kernel, CPU, RAM, storage, battery, IP, root status, security patch, bootloader state
- Wireless ADB — enable TCP/IP, connect/disconnect
- One-click reboot to system / recovery / bootloader / fastboot / sideload

### 📁 File Explorer
- Browse the device filesystem
- Push, pull, rename, copy, delete, create folders
- Batch select and export multiple files
- No timeout on large transfers

### 📦 Package Manager
- List all / user / system / disabled packages
- Batch install, uninstall, enable, disable
- Pull APK from device, clear data, force stop
- Install APKs from local files

### 🛡️ Debloater
- **2,157 packages** from the Universal Android Debloater (UAD-ng) database
- Covers: Samsung, Xiaomi, OnePlus/Oppo, Huawei, Sony, Motorola, LG, Nokia, Asus, Realme, Google, Carriers, AOSP
- Safety ratings: Safe / Caution / Keep
- Dependency warnings
- Filter by manufacturer, safety level, or search
- Batch disable or uninstall for user 0

### 📜 Live Logcat
- Real-time streaming via Wails events
- Colour-coded by log level (V/D/I/W/E/F)
- Filter by level, tag, or search string
- Buffer selector: main / radio / events / crash / all
- Auto-scroll, save to file, clear buffer

### 🔍 App Inspector
- Deep package inspection: version, paths, UID, install dates, debuggable flag
- All granted permissions
- Activities, services, broadcast receivers, content providers
- Native libraries (.so files)
- Signing certificate info
- Full package dump
- Certificate pinning heuristic check (OkHttp, TrustKit, networkSecurityConfig)

### 🔒 Certificate Manager
- List all system and user CA certificates
- Install user CA certificates (for Burp Suite / mitmproxy HTTPS interception)
- Remove user certificates
- Fingerprint and expiry display
- Built-in HTTPS interception setup guide

### 💾 Device Backup
- `adb backup` with APK, shared storage, and app selection options
- Restore from `.adb` backup files
- Honest warnings about Android 12+ restrictions

### ⚙️ Prop Editor
- View all 300+ system properties grouped by category
- Search and filter
- Edit properties inline (uses root if available)
- Read-only properties clearly marked

### 💻 Shell Terminal
- Direct `adb shell` and `adb host` command execution
- Command history (arrow keys)
- No shell injection — args are split directly, no shell interpretation

### 🔧 Utilities
- **487 commands** across 15 categories:
  Device Info, Processes & Memory, Battery & Power, Network & Connectivity,
  Permissions & Security, Package Manager, Activities & Services, Sensors & Media,
  Logs & Diagnostics, File System, Settings & Config, **Fastboot** (including all
  `fastboot oem` commands), Root & Magisk, Instrumentation & Testing, Reboot
- Commands that need arguments prompt inline before running
- Search across all commands
- Output copy button

### ⚡ Flasher (Fastboot)
- Flash individual partitions
- Fastboot getvar queries
- ADB sideload
- Partition allowlist prevents accidental flashes to wrong targets

### 📲 Pixel Factory Flash
- Select a Pixel factory image zip directly from Google
- Reads `flash-all.sh` from inside the zip — executes the correct sequence automatically
- Options: wipe data, disable verity, disable verification, **force flash**, flash both slots
- Step-by-step live progress with per-step status
- Live flash log

---

## Security Design

- **No bundled binaries** — uses system `adb`/`fastboot` from your PATH
- **Settings view shows SHA-256** of whichever binary is being used — verify it yourself
- **No shell string building** — every command uses `exec.Command(binary, arg1, arg2, ...)` with discrete args passed directly to execve. No shell injection surface.
- **Input validation** — package names, partition names, IP addresses, and paths all validated before use
- **Partition allowlist** — fastboot flash only accepts known partition names

---

## Building from Source

### Prerequisites (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev adb fastboot curl wget git

# Go 1.23
wget https://go.dev/dl/go1.23.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.23.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
source ~/.bashrc

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

### Build

```bash
git clone https://github.com/jegly/ATK
cd ATK
go mod tidy
cd frontend && pnpm install && cd ..
wails build -tags webkit2_41

# Binary output
./build/bin/ATK
```

### Install system-wide

```bash
sudo cp build/bin/ATK /usr/local/bin/atk
```

### Build .deb package

```bash
# Install nfpm
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest

# Build binary first
wails build -tags webkit2_41

# Package as .deb
nfpm pkg --packager deb --target build/
```

### Dev mode (hot reload)

```bash
wails dev -tags webkit2_41
```

---

## Licence

ATK is licensed under the **GNU General Public License v3.0**.

The debloater package database is sourced from
[Universal Android Debloater Next Generation](https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation)
(GPL-3.0, Universal-Debloater-Alliance).

See [LICENSE](LICENSE) for full terms and third-party attributions.

---

## Acknowledgements

- [Universal Android Debloater Alliance](https://github.com/Universal-Debloater-Alliance) — package database
- [Wails](https://wails.io) — Go + Web framework
- [PixelFlasher](https://github.com/badabing2005/PixelFlasher) — Pixel flash sequence reference
- [Lucide](https://lucide.dev) — icons
- [shadcn/ui](https://ui.shadcn.com) — UI components
