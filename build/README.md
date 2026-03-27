# Build Directory

## Building the binary

```bash
wails build -tags webkit2_41
# Output: build/bin/ATK
```

## Building the .deb package

Requires [nfpm](https://nfpm.goreleaser.com/):

```bash
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest
```

Then build the binary first, then package:

```bash
wails build -tags webkit2_41
nfpm pkg --packager deb --target build/
# Output: build/atk_1.0.0_amd64.deb
```

Install the .deb:

```bash
sudo dpkg -i build/atk_1.0.0_amd64.deb
# Then run:
atk
```

## App icon

Replace `build/appicon.png` with a 256x256 PNG to customise the application icon.
The icon is used in the .deb package and the Linux app launcher.
