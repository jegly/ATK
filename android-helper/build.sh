#!/usr/bin/env bash
# Rebuild the ATK privileged-uninstall helper dex (android-helper/atk-helper.dex).
#
# This is the on-device helper ATK pushes and runs via `app_process` (as the
# shell user, uid 2000) to remove protected system apps that `pm uninstall`
# refuses - the same technique Canta uses via Shizuku, but driven over adb with
# no root and no Shizuku app. It calls IPackageInstaller.uninstall() directly
# with the DELETE_SYSTEM_APP flag.
#
# Requires: a JDK (javac) and Android SDK build-tools (d8) + a platform android.jar.
set -euo pipefail
cd "$(dirname "$0")"

JAVAC="${JAVAC:-$(command -v javac)}"
ANDROID_JAR="${ANDROID_JAR:-$HOME/Android/Sdk/platforms/android-37.0/android.jar}"
D8="${D8:-$HOME/Android/Sdk/build-tools/37.0.0/d8}"

rm -rf classes && mkdir -p classes
"$JAVAC" --release 17 -cp "$ANDROID_JAR" -d classes Main.java
"$D8" --min-api 26 --output . classes/*.class
mv classes.dex atk-helper.dex
rm -rf classes
echo "Built atk-helper.dex ($(stat -c%s atk-helper.dex) bytes)"
