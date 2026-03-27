```
 █████╗ ████████╗██╗  ██╗
██╔══██╗╚══██╔══╝██║ ██╔╝
███████║   ██║   █████╔╝ 
██╔══██║   ██║   ██╔═██╗ 
██║  ██║   ██║   ██║  ██╗
╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
ANDROID TOOLKIT — v1.0.5
```

> All-in-one ADB command centre for Android power users, security researchers, and bug hunters.
> Built with Go + React via Wails. Runs natively on Linux, Windows, and macOS.
> Uses your system ADB — no bundled binaries, no mystery executables.

---

```
[ DOWNLOADS ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Platform              | Format      | Install                                          |
|-----------------------|-------------|--------------------------------------------------|
| Linux — Debian/Ubuntu | `.deb`      | `sudo dpkg -i ATK-*.deb`                        |
| Linux — any distro    | `.AppImage` | `chmod +x ATK-*.AppImage && ./ATK-*.AppImage`   |
| Windows               | `.exe`      | Run directly                                     |
| macOS 11.0+           | `.dmg`      | Unsigned — see note below                       |

**[→ Latest Release](https://github.com/jegly/ATK/releases/latest)**

**Linux requirements**
```bash
sudo apt install adb fastboot libwebkit2gtk-4.1-0
```

**macOS — Gatekeeper bypass**
```bash
xattr -rd com.apple.quarantine /Applications/ATK.app
# or: System Preferences → Security & Privacy → Open Anyway
```

---

```
[ MODULES ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
┌─────────────────────┬────────────────────────────────────────────────────┐
│ MODULE              │ DESCRIPTION                                        │
├─────────────────────┼────────────────────────────────────────────────────┤
│ Dashboard           │ Device info, wireless ADB, reboot controls         │
│ File Explorer       │ Push, pull, rename, delete, batch export           │
│ Package Manager     │ Install, uninstall, enable, disable, pull APK      │
│ Debloater           │ 2157 packages — Samsung, Xiaomi, Google, 10+ OEMs  │
│ Live Logcat         │ Real-time streaming, level filter, tag filter       │
│ App Inspector       │ Permissions, components, certs, pinning check      │
│ Certificate Manager │ Install/remove user CAs for HTTPS interception     │
│ Device Backup       │ adb backup with app selection and restore          │
│ Prop Editor         │ Read/write all 300+ system properties              │
│ Shell Terminal      │ adb shell and host commands, command history        │
│ Utilities           │ 487 commands across 15 categories                  │
│ Flasher             │ Fastboot partition flash, getvar, sideload         │
│ Pixel Factory Flash │ Full factory image flash from flash-all.sh         │
└─────────────────────┴────────────────────────────────────────────────────┘
```

---

```
[ SECURITY ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
NO BUNDLED BINARIES
  ATK has no bin/ directory. It resolves adb and fastboot from your system
  PATH — installed via apt, Homebrew, or Android SDK. The Settings view
  displays the full path and SHA-256 of whichever binary is in use so you
  can verify it against Google's published platform-tools checksums.

NO SHELL STRING BUILDING
  Every command uses exec.Command(binary, arg1, arg2, ...) with discrete
  arguments passed directly to execve. There is no shell involved and
  therefore no shell injection surface.

INPUT VALIDATION
  Package names, partition names, IP addresses, and remote paths are all
  validated before use. Fastboot flash only accepts a known partition
  allowlist — no arbitrary partition names accepted.
```

---

```
[ DEBLOATER ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Package database sourced from Universal Android Debloater (UAD-ng). 2,157
packages across 14 manufacturers and categories, each with safety ratings:

```
  SAFE     — generally safe to remove
  CAUTION  — disable rather than uninstall; may affect device behaviour  
  KEEP     — do not remove; will break core system functionality
```

Coverage: Samsung · Xiaomi · OnePlus/Oppo · Huawei · Sony · Motorola · LG
          Nokia/HMD · Asus · Realme · Google · Carriers · AOSP · Misc

---

```
[ PIXEL FACTORY FLASH ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

ATK reads `flash-all.sh` directly from inside the factory image zip and
executes the correct sequence — no hardcoded partition order. Options:

```
  --wipe               Wipe userdata (-w flag on fastboot update)
  --disable-verity     For Magisk / root setups
  --disable-verif      Paired with disable-verity
  --force              Bypass anti-rollback (use with caution)
  --slot all           Flash both A and B slots
```

Download factory images from: https://developers.google.com/android/images

---

```
[ BUILD FROM SOURCE ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Prerequisites — Ubuntu/Debian**
```bash
sudo apt install -y build-essential pkg-config libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev adb fastboot

# Go 1.23
wget https://go.dev/dl/go1.23.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.23.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
source ~/.bashrc

# Node + pnpm + Wails
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

**Build**
```bash
git clone https://github.com/jegly/ATK
cd ATK
go mod tidy
cd frontend && pnpm install && cd ..
wails build -tags webkit2_41
./build/bin/ATK
```

**Dev mode (hot reload)**
```bash
wails dev -tags webkit2_41
```

**Package as .deb**
```bash
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest
wails build -tags webkit2_41
nfpm pkg --packager deb --target build/
sudo dpkg -i build/atk_*.deb
```

---

```
[ ARCH LINUX ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

A `PKGBUILD` is included in `aur/`. See `aur/README.md` for publishing to
the AUR. Until then, Arch users can use the `.AppImage` from the releases
page — no installation required.

---

```
[ LICENCE ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

ATK is released under the GNU General Public License v3.0.

The debloater package database is from Universal Android Debloater Next
Generation (GPL-3.0) by the Universal-Debloater-Alliance.

See LICENSE for full terms and third-party attributions.

---

```
[ ACKNOWLEDGEMENTS ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
  Universal Android Debloater Alliance  — debloater package database
  Wails                                 — Go + Web application framework
  PixelFlasher (badabing2005)           — Pixel flash sequence reference
  Lucide                                — icon set
```

---

```
  github.com/jegly/ATK
```
