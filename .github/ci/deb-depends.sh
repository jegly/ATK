#!/usr/bin/env bash
# Write nfpm.ci.yaml: nfpm.yaml with the library dependencies of build/bin/ATK
# worked out by dpkg-shlibdeps (versioned minimums of the system it was built
# on), plus adb and fastboot, which the binary runs rather than links.
set -euo pipefail

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/debian"
printf 'Source: atk\n\nPackage: atk\nArchitecture: any\n' > "$tmp/debian/control"
shlibs=$(cd "$tmp" && dpkg-shlibdeps -O "$OLDPWD/build/bin/ATK" | sed 's/^shlibs:Depends=//')
echo "Library dependencies: $shlibs"

python3 - "$shlibs" <<'EOF'
import re, sys
s = open("nfpm.yaml").read()
m = re.search(r"^depends:\n((?:  - .*\n)+)", s, re.M)
if not m:
    sys.exit("nfpm.yaml: no depends: list found")
tools = [l.strip()[2:].strip().strip('"') for l in m.group(1).splitlines()
         if l.strip()[2:].strip().strip('"') in ("adb", "fastboot")]
libs = [d.strip() for d in sys.argv[1].split(",") if d.strip()]
block = "depends:\n" + "".join(f'  - "{d}"\n' for d in tools + libs)
open("nfpm.ci.yaml", "w").write(s.replace(m.group(0), block))
EOF
