import { useState } from 'react'
import { FileText, Wrench, ChevronDown, ChevronRight, Play, Copy, Check } from 'lucide-react'
import { Reboot, RunAdbHostCommand } from '../../lib/wails'
import { notify } from '../../lib/notify'

interface Command {
  label: string
  cmd: string
  needsInput?: { placeholder: string; token: string }[]
}

interface Category {
  name: string
  commands: Command[]
}

const CATEGORIES: Category[] = [
  // ─────────────────────────────────────────────
  {
    name: 'Device Info',
    commands: [
      { label: 'All system properties',               cmd: 'shell getprop' },
      { label: 'Android version',                     cmd: 'shell getprop ro.build.version.release' },
      { label: 'Android SDK level',                   cmd: 'shell getprop ro.build.version.sdk' },
      { label: 'Device model',                        cmd: 'shell getprop ro.product.model' },
      { label: 'Device brand',                        cmd: 'shell getprop ro.product.brand' },
      { label: 'Device codename',                     cmd: 'shell getprop ro.product.device' },
      { label: 'Build fingerprint',                   cmd: 'shell getprop ro.build.fingerprint' },
      { label: 'Build ID',                            cmd: 'shell getprop ro.build.id' },
      { label: 'Build description',                   cmd: 'shell getprop ro.build.description' },
      { label: 'Build tags',                          cmd: 'shell getprop ro.build.tags' },
      { label: 'Build type (user/userdebug/eng)',     cmd: 'shell getprop ro.build.type' },
      { label: 'Security patch level',                cmd: 'shell getprop ro.build.version.security_patch' },
      { label: 'Bootloader version',                  cmd: 'shell getprop ro.bootloader' },
      { label: 'Baseband / radio version',            cmd: 'shell getprop gsm.version.baseband' },
      { label: 'Hardware revision',                   cmd: 'shell getprop ro.hardware' },
      { label: 'CPU ABI',                             cmd: 'shell getprop ro.product.cpu.abi' },
      { label: 'CPU ABI list (all)',                  cmd: 'shell getprop ro.product.cpu.abilist' },
      { label: 'Device serial number',                cmd: 'get-serialno' },
      { label: 'Current device state',                cmd: 'get-state' },
      { label: 'Connected devices',                   cmd: 'devices' },
      { label: 'Connected devices (verbose)',          cmd: 'devices -l' },
      { label: 'Kernel version',                      cmd: 'shell cat /proc/version' },
      { label: 'Kernel command line',                 cmd: 'shell cat /proc/cmdline' },
      { label: 'System uptime',                       cmd: 'shell cat /proc/uptime' },
      { label: 'Load average',                        cmd: 'shell cat /proc/loadavg' },
      { label: 'CPU info',                            cmd: 'shell cat /proc/cpuinfo' },
      { label: 'Memory info',                         cmd: 'shell cat /proc/meminfo' },
      { label: 'CPU statistics',                      cmd: 'shell cat /proc/stat' },
      { label: 'Partition table',                     cmd: 'shell cat /proc/partitions' },
      { label: 'Supported filesystems',               cmd: 'shell cat /proc/filesystems' },
      { label: 'Scheduler debug info',                cmd: 'shell cat /proc/sched_debug' },
      { label: 'Interrupt counts',                    cmd: 'shell cat /proc/interrupts' },
      { label: 'Registered devices',                  cmd: 'shell cat /proc/devices' },
      { label: 'Control groups info',                 cmd: 'shell cat /proc/cgroups' },
      { label: 'Current shell process status',        cmd: 'shell cat /proc/self/status' },
      { label: 'Memory zones (zoneinfo)',              cmd: 'shell cat /proc/zoneinfo' },
      { label: 'Kernel slab allocator',               cmd: 'shell cat /proc/slabinfo' },
      { label: 'Kernel wakelocks (root)',              cmd: 'shell cat /proc/wakelocks' },
      { label: 'Kernel modules loaded',               cmd: 'shell lsmod' },
      { label: 'Device tree (dtb) info',              cmd: 'shell ls /proc/device-tree' },
      { label: 'ADB version',                         cmd: 'version' },
      { label: 'SELinux enforce status',              cmd: 'shell getenforce' },
      { label: 'SELinux policy version',              cmd: 'shell cat /sys/fs/selinux/policyvers' },
      { label: 'uname -a (full kernel info)',         cmd: 'shell uname -a' },
      { label: 'Android ID',                          cmd: 'shell settings get secure android_id' },
      { label: 'Timezone',                            cmd: 'shell getprop persist.sys.timezone' },
      { label: 'Language locale',                     cmd: 'shell getprop persist.sys.locale' },
      { label: 'Screen density (DPI)',                cmd: 'shell getprop ro.sf.lcd_density' },
      { label: 'Encryption state',                    cmd: 'shell getprop ro.crypto.state' },
      { label: 'Encryption type',                     cmd: 'shell getprop ro.crypto.type' },
      { label: 'Verified boot state',                 cmd: 'shell getprop ro.boot.verifiedbootstate' },
      { label: 'Flash locked state',                  cmd: 'shell getprop ro.boot.flash.locked' },
      { label: 'vbmeta device state',                 cmd: 'shell getprop ro.boot.vbmeta.device_state' },
      { label: 'Active slot (A/B)',                   cmd: 'shell getprop ro.boot.slot_suffix' },
      { label: 'Dynamic partitions enabled',          cmd: 'shell getprop ro.boot.dynamic_partitions' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Processes & Memory',
    commands: [
      { label: 'All running processes',               cmd: 'shell ps -A' },
      { label: 'Processes with threads',              cmd: 'shell ps -AT' },
      { label: 'Process tree',                        cmd: 'shell ps -A --forest' },
      { label: 'Live CPU & memory (top)',              cmd: 'shell top -n 1' },
      { label: 'Top sorted by CPU',                   cmd: 'shell top -n 1 -s cpu' },
      { label: 'Top sorted by memory',                cmd: 'shell top -n 1 -s rss' },
      { label: 'Memory details (meminfo)',             cmd: 'shell dumpsys meminfo' },
      { label: 'CPU usage snapshot',                  cmd: 'shell dumpsys cpuinfo' },
      { label: 'Process statistics',                  cmd: 'shell dumpsys procstats' },
      { label: 'Process stats last 3 hours',          cmd: 'shell dumpsys procstats --hours 3' },
      { label: 'Process stats last 24 hours',         cmd: 'shell dumpsys procstats --hours 24' },
      { label: 'Detailed process info (activity)',    cmd: 'shell dumpsys activity processes' },
      { label: 'Virtual memory statistics',           cmd: 'shell vmstat' },
      { label: 'I/O statistics',                      cmd: 'shell iostat' },
      { label: 'List open files (root)',               cmd: 'shell lsof' },
      { label: 'OOM killer log',                      cmd: 'shell dmesg | grep -i oom' },
      { label: 'Low memory killer log',               cmd: 'shell dmesg | grep -i lowmemorykiller' },
      { label: 'Zygote PID',                          cmd: 'shell pidof zygote' },
      { label: 'System server PID',                   cmd: 'shell pidof system_server' },
      { label: 'strace on PID (requires root)',
        cmd: 'shell strace -p <pid>',
        needsInput: [{ placeholder: '1234', token: '<pid>' }] },
      { label: 'Kill process by PID (requires root)',
        cmd: 'shell kill -9 <pid>',
        needsInput: [{ placeholder: '1234', token: '<pid>' }] },
      { label: 'Memory map for PID',
        cmd: 'shell cat /proc/<pid>/maps',
        needsInput: [{ placeholder: '1234', token: '<pid>' }] },
      { label: 'File descriptors for PID',
        cmd: 'shell ls -la /proc/<pid>/fd',
        needsInput: [{ placeholder: '1234', token: '<pid>' }] },
      { label: 'CPU frequencies (all cores)',          cmd: 'shell cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq' },
      { label: 'CPU governor',                        cmd: 'shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor' },
      { label: 'Available CPU governors',             cmd: 'shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors' },
      { label: 'Max CPU frequency',                   cmd: 'shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq' },
      { label: 'Min CPU frequency',                   cmd: 'shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Battery & Power',
    commands: [
      { label: 'Battery state',                       cmd: 'shell dumpsys battery' },
      { label: 'Battery usage stats',                 cmd: 'shell dumpsys batterystats' },
      { label: 'Full battery history',                cmd: 'shell dumpsys batterystats --history' },
      { label: 'Battery history (last charge)',       cmd: 'shell dumpsys batterystats --charged' },
      { label: 'Battery checkin format',              cmd: 'shell dumpsys batterystats --checkin' },
      { label: 'Reset battery stats',                 cmd: 'shell dumpsys batterystats --reset' },
      { label: 'Power manager & doze state',          cmd: 'shell dumpsys power' },
      { label: 'Doze / idle mode state',              cmd: 'shell dumpsys deviceidle' },
      { label: 'Force doze mode on',                  cmd: 'shell dumpsys deviceidle force-idle' },
      { label: 'Force doze mode off',                 cmd: 'shell dumpsys deviceidle unforce' },
      { label: 'Step into doze (light)',               cmd: 'shell dumpsys deviceidle step light' },
      { label: 'Step into doze (deep)',                cmd: 'shell dumpsys deviceidle step deep' },
      { label: 'Pending alarms',                      cmd: 'shell dumpsys alarm' },
      { label: 'Scheduled jobs',                      cmd: 'shell dumpsys jobscheduler' },
      { label: 'Job history',                         cmd: 'shell dumpsys jobscheduler history' },
      { label: 'Thermal throttling state',            cmd: 'shell dumpsys thermalservice' },
      { label: 'Hardware sensors & temps',            cmd: 'shell dumpsys hardware_properties' },
      { label: 'All thermal zones',                   cmd: 'shell cat /sys/class/thermal/thermal_zone*/temp' },
      { label: 'Thermal zone types',                  cmd: 'shell cat /sys/class/thermal/thermal_zone*/type' },
      { label: 'Battery raw info (/sys)',              cmd: 'shell cat /sys/class/power_supply/battery/uevent' },
      { label: 'Battery capacity (%)',                 cmd: 'shell cat /sys/class/power_supply/battery/capacity' },
      { label: 'Battery status',                      cmd: 'shell cat /sys/class/power_supply/battery/status' },
      { label: 'Battery voltage (µV)',                 cmd: 'shell cat /sys/class/power_supply/battery/voltage_now' },
      { label: 'Battery current (µA)',                 cmd: 'shell cat /sys/class/power_supply/battery/current_now' },
      { label: 'Battery temperature',                 cmd: 'shell cat /sys/class/power_supply/battery/temp' },
      { label: 'Battery health',                      cmd: 'shell cat /sys/class/power_supply/battery/health' },
      { label: 'Battery charge counter (µAh)',         cmd: 'shell cat /sys/class/power_supply/battery/charge_counter' },
      { label: 'USB power supply info',               cmd: 'shell cat /sys/class/power_supply/usb/uevent' },
      { label: 'AC power supply info',                cmd: 'shell cat /sys/class/power_supply/ac/uevent' },
      { label: 'Wakelocks (kernel)',                  cmd: 'shell cat /sys/kernel/debug/wakeup_sources' },
      { label: 'Active wakelocks',                    cmd: 'shell cat /proc/wakelocks' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Network & Connectivity',
    commands: [
      { label: 'Full network state',                  cmd: 'shell dumpsys connectivity' },
      { label: 'Wi-Fi state & networks',              cmd: 'shell dumpsys wifi' },
      { label: 'Wi-Fi scanner results',               cmd: 'shell dumpsys wifiscanner' },
      { label: 'Detailed traffic stats',              cmd: 'shell dumpsys netstats' },
      { label: 'Signal & telephony info',             cmd: 'shell dumpsys telephony.registry' },
      { label: 'Tethering / hotspot state',           cmd: 'shell dumpsys tethering' },
      { label: 'Ethernet service state',              cmd: 'shell dumpsys ethernet' },
      { label: 'Connectivity metrics',                cmd: 'shell dumpsys connectivity_metrics' },
      { label: 'Network policy rules',                cmd: 'shell dumpsys netpolicy' },
      { label: 'Network management service',          cmd: 'shell dumpsys network_management' },
      { label: 'UWB subsystem state',                 cmd: 'shell dumpsys uwb' },
      { label: 'Carrier configuration',              cmd: 'shell dumpsys carrier_config' },
      { label: 'NFC state',                           cmd: 'shell dumpsys nfc' },
      { label: 'Bluetooth state',                     cmd: 'shell dumpsys bluetooth_manager' },
      { label: 'Bluetooth adapter info',              cmd: 'shell dumpsys bluetooth' },
      { label: 'IP addresses (all interfaces)',        cmd: 'shell ip addr show' },
      { label: 'IP addresses (wlan0)',                 cmd: 'shell ip addr show wlan0' },
      { label: 'Routing table',                       cmd: 'shell ip route show' },
      { label: 'IPv6 routing table',                  cmd: 'shell ip -6 route show' },
      { label: 'IP rules',                            cmd: 'shell ip rule show' },
      { label: 'ARP table',                           cmd: 'shell ip neigh show' },
      { label: 'ARP table (arp)',                     cmd: 'shell arp -n' },
      { label: 'Open sockets with PIDs (ss)',          cmd: 'shell ss -tulpn' },
      { label: 'All sockets (ss)',                    cmd: 'shell ss -a' },
      { label: 'Listening ports (netstat)',            cmd: 'shell netstat -tuln' },
      { label: 'All connections (netstat)',            cmd: 'shell netstat -an' },
      { label: 'Network interfaces (ifconfig)',        cmd: 'shell ifconfig' },
      { label: 'Firewall rules IPv4 (root)',           cmd: 'shell iptables -L -v -n' },
      { label: 'Firewall rules IPv6 (root)',           cmd: 'shell ip6tables -L -v -n' },
      { label: 'iptables NAT table (root)',            cmd: 'shell iptables -t nat -L -v -n' },
      { label: 'Ping test to 8.8.8.8',                cmd: 'shell ping -c 4 8.8.8.8' },
      { label: 'Ping test to 1.1.1.1',                cmd: 'shell ping -c 4 1.1.1.1' },
      { label: 'Traceroute to 8.8.8.8',               cmd: 'shell traceroute 8.8.8.8' },
      { label: 'DNS lookup (nslookup)',                cmd: 'shell nslookup google.com' },
      { label: 'DNS lookup (getent)',                  cmd: 'shell getent hosts google.com' },
      { label: 'resolv.conf',                         cmd: 'shell cat /etc/resolv.conf' },
      { label: 'TCP connections (/proc)',              cmd: 'shell cat /proc/net/tcp' },
      { label: 'TCP6 connections (/proc)',             cmd: 'shell cat /proc/net/tcp6' },
      { label: 'UDP connections (/proc)',              cmd: 'shell cat /proc/net/udp' },
      { label: 'Network device stats (/proc)',         cmd: 'shell cat /proc/net/dev' },
      { label: 'Wireless info (/proc)',                cmd: 'shell cat /proc/net/wireless' },
      { label: 'ARP cache (/proc)',                    cmd: 'shell cat /proc/net/arp' },
      { label: 'Network interface stats (/sys)',       cmd: 'shell cat /sys/class/net/wlan0/statistics/rx_bytes' },
      { label: 'TX bytes (wlan0)',                     cmd: 'shell cat /sys/class/net/wlan0/statistics/tx_bytes' },
      { label: 'Disable mobile data',                 cmd: 'shell svc data disable' },
      { label: 'Enable mobile data',                  cmd: 'shell svc data enable' },
      { label: 'Disable Wi-Fi',                       cmd: 'shell svc wifi disable' },
      { label: 'Enable Wi-Fi',                        cmd: 'shell svc wifi enable' },
      { label: 'Disable NFC',                         cmd: 'shell svc nfc disable' },
      { label: 'Enable NFC',                          cmd: 'shell svc nfc enable' },
      { label: 'Disable Bluetooth',                   cmd: 'shell svc bluetooth disable' },
      { label: 'Enable Bluetooth',                    cmd: 'shell svc bluetooth enable' },
      { label: 'Telephony commands',                  cmd: 'shell cmd phone' },
      { label: 'List all network interfaces',         cmd: 'shell ls /sys/class/net' },
      { label: 'Wi-Fi SSID currently connected',      cmd: 'shell dumpsys wifi | grep -i mWifiInfo' },
      { label: 'IMSI (root required)',                 cmd: 'shell service call iphonesubinfo 7' },
      { label: 'SIM operator name',                   cmd: 'shell getprop gsm.sim.operator.alpha' },
      { label: 'SIM state',                           cmd: 'shell getprop gsm.sim.state' },
      { label: 'Mobile network type',                 cmd: 'shell getprop gsm.network.type' },
      { label: 'Phone number',                        cmd: 'shell service call iphonesubinfo 11' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Permissions & Security',
    commands: [
      { label: 'All app operations & permissions',    cmd: 'shell dumpsys appops' },
      { label: 'Accessibility services',              cmd: 'shell dumpsys accessibility' },
      { label: 'Keystore state',                      cmd: 'shell dumpsys keystore' },
      { label: 'Security manager state',              cmd: 'shell dumpsys security' },
      { label: 'OEM lock state',                      cmd: 'shell dumpsys oemlock' },
      { label: 'Device policy manager',               cmd: 'shell dumpsys device_policy' },
      { label: 'User accounts & profiles',            cmd: 'shell dumpsys user' },
      { label: 'User restrictions',                   cmd: 'shell dumpsys restrictions' },
      { label: 'Role manager state',                  cmd: 'shell dumpsys role' },
      { label: 'Trust agents',                        cmd: 'shell dumpsys trust' },
      { label: 'SELinux enforce status',              cmd: 'shell getenforce' },
      { label: 'SELinux set to enforcing',            cmd: 'shell setenforce 1' },
      { label: 'SELinux set to permissive',           cmd: 'shell setenforce 0' },
      { label: 'SELinux audit log',                   cmd: 'shell dmesg | grep avc' },
      { label: 'SELinux denials in logcat',           cmd: 'logcat -d | grep avc' },
      { label: 'All permissions declared',            cmd: 'shell dumpsys package permissions' },
      { label: 'All permission groups',               cmd: 'shell pm list permission-groups' },
      { label: 'All permissions',                     cmd: 'shell pm list permissions' },
      { label: 'Dangerous permissions only',          cmd: 'shell pm list permissions -d' },
      { label: 'Groups permissions',                  cmd: 'shell pm list permissions -g' },
      { label: 'SafetyNet / Play Integrity check',    cmd: 'shell am start -a android.intent.action.VIEW -d https://www.google.com/safebrowsing' },
      { label: 'Verify boot state (vbmeta)',          cmd: 'shell getprop ro.boot.verifiedbootstate' },
      { label: 'Check if rooted (su)',                cmd: 'shell which su' },
      { label: 'Check Magisk presence',               cmd: 'shell ls /data/adb/magisk' },
      { label: 'Trusted CA certificates',             cmd: 'shell ls /system/etc/security/cacerts' },
      { label: 'User-installed CA certificates',      cmd: 'shell ls /data/misc/user/0/cacerts-added' },
      { label: 'Keystore keys (root)',                cmd: 'shell ls /data/misc/keystore' },
      { label: 'Audit log (root)',                    cmd: 'shell cat /data/misc/audit/audit.log' },
      {
        label: 'App permissions (specific package)',
        cmd: 'shell dumpsys appops get <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'List permissions for package',
        cmd: 'shell pm list permissions -p <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Grant permission to app',
        cmd: 'shell pm grant <package> <permission>',
        needsInput: [
          { placeholder: 'com.example.app', token: '<package>' },
          { placeholder: 'android.permission.CAMERA', token: '<permission>' },
        ],
      },
      {
        label: 'Revoke permission from app',
        cmd: 'shell pm revoke <package> <permission>',
        needsInput: [
          { placeholder: 'com.example.app', token: '<package>' },
          { placeholder: 'android.permission.CAMERA', token: '<permission>' },
        ],
      },
      {
        label: 'Reset all permissions for app',
        cmd: 'shell pm reset-permissions <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Package Manager',
    commands: [
      { label: 'All packages',                        cmd: 'shell pm list packages' },
      { label: 'System packages only',                cmd: 'shell pm list packages -s' },
      { label: 'User / third-party packages',         cmd: 'shell pm list packages -3' },
      { label: 'Disabled packages',                   cmd: 'shell pm list packages -d' },
      { label: 'Enabled packages',                    cmd: 'shell pm list packages -e' },
      { label: 'Packages with APK path',              cmd: 'shell pm list packages -f' },
      { label: 'Packages with installer source',      cmd: 'shell pm list packages -i' },
      { label: 'Packages with UID',                   cmd: 'shell pm list packages -U' },
      { label: 'All package manager info',            cmd: 'shell dumpsys package' },
      { label: 'App usage stats',                     cmd: 'shell dumpsys usage' },
      { label: 'App shortcuts',                       cmd: 'shell dumpsys shortcut' },
      { label: 'Activity stack list',                 cmd: 'shell am stack list' },
      { label: 'Get device configuration',            cmd: 'shell am get-config' },
      { label: 'List features',                       cmd: 'shell pm list features' },
      { label: 'List libraries',                      cmd: 'shell pm list libraries' },
      { label: 'List instrumentation',                cmd: 'shell pm list instrumentation' },
      { label: 'List users',                          cmd: 'shell pm list users' },
      {
        label: 'APK path for package',
        cmd: 'shell pm path <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Full dump for package',
        cmd: 'shell pm dump <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Force stop app',
        cmd: 'shell am force-stop <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Kill app (background)',
        cmd: 'shell am kill <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Launch activity',
        cmd: 'shell am start -n <package>/<activity>',
        needsInput: [
          { placeholder: 'com.example.app', token: '<package>' },
          { placeholder: '.MainActivity', token: '<activity>' },
        ],
      },
      {
        label: 'Launch app (main intent)',
        cmd: 'shell monkey -p <package> -c android.intent.category.LAUNCHER 1',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Clear app data',
        cmd: 'shell pm clear <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Send broadcast intent',
        cmd: 'shell am broadcast -a <intent>',
        needsInput: [{ placeholder: 'android.intent.action.VIEW', token: '<intent>' }],
      },
      {
        label: 'Trim memory (MODERATE)',
        cmd: 'shell am send-trim-memory <package> MODERATE',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Trim memory (COMPLETE)',
        cmd: 'shell am send-trim-memory <package> COMPLETE',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Get UID for package',
        cmd: 'shell cat /data/system/packages.xml | grep <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Monkey stress test (1000 events)',
        cmd: 'shell monkey -p <package> 1000',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Activities & Services',
    commands: [
      { label: 'Activities & services (all)',          cmd: 'shell dumpsys activity' },
      { label: 'Running services',                    cmd: 'shell dumpsys activity services' },
      { label: 'Broadcast receivers',                 cmd: 'shell dumpsys activity broadcasts' },
      { label: 'Recent intents',                      cmd: 'shell dumpsys activity intents' },
      { label: 'Recent tasks',                        cmd: 'shell dumpsys activity recents' },
      { label: 'Activity top (foreground)',            cmd: 'shell dumpsys activity top' },
      { label: 'Activity starter history',            cmd: 'shell dumpsys activity starter' },
      { label: 'Window manager state',                cmd: 'shell dumpsys window' },
      { label: 'Visible windows only',                cmd: 'shell dumpsys window windows | grep -E name=' },
      { label: 'Window display info',                 cmd: 'shell dumpsys window displays' },
      { label: 'Display config',                      cmd: 'shell dumpsys display' },
      { label: 'Input events',                        cmd: 'shell dumpsys input' },
      { label: 'Input method (IME) state',            cmd: 'shell dumpsys input_method' },
      { label: 'Notification listeners',              cmd: 'shell dumpsys notification' },
      { label: 'Clipboard state',                     cmd: 'shell dumpsys clipboard' },
      { label: 'Voice interaction service',           cmd: 'shell dumpsys voiceinteraction' },
      { label: 'Text services (spellcheck)',           cmd: 'shell dumpsys textservices' },
      { label: 'Text classification service',         cmd: 'shell dumpsys textclassification' },
      { label: 'Wallpaper manager',                   cmd: 'shell dumpsys wallpaper' },
      { label: 'Lock screen state',                   cmd: 'shell dumpsys window | grep -i mDreamingLockscreen' },
      { label: 'Screen on/off state',                 cmd: 'shell dumpsys power | grep mWakefulness' },
      { label: 'Turn screen on',                      cmd: 'shell input keyevent 26' },
      { label: 'Dismiss keyguard',                    cmd: 'shell wm dismiss-keyguard' },
      { label: 'Take screenshot to /sdcard',          cmd: 'shell screencap /sdcard/screenshot.png' },
      { label: 'Screen record 10s to /sdcard',        cmd: 'shell screenrecord --time-limit 10 /sdcard/record.mp4' },
      { label: 'Simulate back button',                cmd: 'shell input keyevent 4' },
      { label: 'Simulate home button',                cmd: 'shell input keyevent 3' },
      { label: 'Simulate menu button',                cmd: 'shell input keyevent 82' },
      { label: 'Simulate power button',               cmd: 'shell input keyevent 26' },
      { label: 'Simulate volume up',                  cmd: 'shell input keyevent 24' },
      { label: 'Simulate volume down',                cmd: 'shell input keyevent 25' },
      { label: 'Swipe up (unlock gesture)',           cmd: 'shell input swipe 540 1600 540 800 300' },
      { label: 'Screen resolution',                   cmd: 'shell wm size' },
      { label: 'Screen density',                      cmd: 'shell wm density' },
      { label: 'Reset screen resolution',             cmd: 'shell wm size reset' },
      { label: 'Reset screen density',                cmd: 'shell wm density reset' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Sensors & Media',
    commands: [
      { label: 'All sensors state',                   cmd: 'shell dumpsys sensorservice' },
      { label: 'Sensor fusion state',                 cmd: 'shell dumpsys sensorservice | grep -A5 fusion' },
      { label: 'Camera & microphone usage',           cmd: 'shell dumpsys media.camera' },
      { label: 'Audio routing & mic usage',           cmd: 'shell dumpsys media.audio_policy' },
      { label: 'Audio streams & buffers',             cmd: 'shell dumpsys media.audio_flinger' },
      { label: 'Media player state',                  cmd: 'shell dumpsys media.player' },
      { label: 'Media metrics',                       cmd: 'shell dumpsys media.metrics' },
      { label: 'Media extractor',                     cmd: 'shell dumpsys media.extractor' },
      { label: 'Graphics rendering stats',            cmd: 'shell dumpsys gfxinfo' },
      { label: 'Surface compositor state',            cmd: 'shell dumpsys surfaceflinger' },
      { label: 'Surface compositor framerate',        cmd: 'shell dumpsys surfaceflinger | grep -i fps' },
      { label: 'SurfaceFlinger layers',               cmd: 'shell dumpsys surfaceflinger --list' },
      { label: 'Vibrator service',                    cmd: 'shell dumpsys vibrator' },
      { label: 'Test vibration (500ms)',               cmd: 'shell cmd vibrator vibrate 500' },
      { label: 'Location services state',             cmd: 'shell dumpsys location' },
      { label: 'Location providers',                  cmd: 'shell dumpsys location | grep -i provider' },
      { label: 'GPS state',                           cmd: 'shell dumpsys location | grep -i gps' },
      { label: 'Country detector',                    cmd: 'shell dumpsys country_detector' },
      { label: 'Fingerprint service',                 cmd: 'shell dumpsys fingerprint' },
      { label: 'Face unlock service',                 cmd: 'shell dumpsys face' },
      { label: 'Biometric service',                   cmd: 'shell dumpsys biometric' },
      {
        label: 'Graphics stats for app',
        cmd: 'shell dumpsys gfxinfo <package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
      {
        label: 'Reset gfxinfo for app',
        cmd: 'shell dumpsys gfxinfo <package> reset',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }],
      },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Logs & Diagnostics',
    commands: [
      { label: 'Logcat dump (last 200 lines)',         cmd: 'logcat -d -t 200' },
      { label: 'Logcat dump (last 500 lines)',         cmd: 'logcat -d -t 500' },
      { label: 'Radio / cellular logs',               cmd: 'logcat -b radio -d -t 200' },
      { label: 'System events logs',                  cmd: 'logcat -b events -d -t 200' },
      { label: 'Crash logs',                          cmd: 'logcat -b crash -d -t 200' },
      { label: 'Errors only (*:E)',                   cmd: 'logcat -d *:E' },
      { label: 'Warnings and above (*:W)',            cmd: 'logcat -d *:W' },
      { label: 'Clear logcat buffer',                 cmd: 'logcat -c' },
      { label: 'Logcat buffer sizes',                 cmd: 'logcat -g' },
      { label: 'Kernel logs (dmesg)',                 cmd: 'shell dmesg' },
      { label: 'Kernel logs (dmesg, last boot)',      cmd: 'shell dmesg --follow-new' },
      { label: 'Kernel errors only (dmesg)',          cmd: 'shell dmesg -l err' },
      { label: 'System crash logs (dropbox)',         cmd: 'shell dumpsys dropbox' },
      { label: 'Dropbox entries list',                cmd: 'shell dumpsys dropbox --list' },
      { label: 'Performance stats',                   cmd: 'shell dumpsys perfstats' },
      { label: 'Disk stats',                          cmd: 'shell dumpsys diskstats' },
      { label: 'Storage daemon info',                 cmd: 'shell dumpsys storaged' },
      { label: 'OTA update engine state',             cmd: 'shell dumpsys update_engine' },
      { label: 'Mount state',                         cmd: 'shell dumpsys mount' },
      { label: 'Backup manager state',                cmd: 'shell dumpsys backup' },
      { label: 'Accounts on device',                  cmd: 'shell dumpsys account' },
      { label: 'Atrace category list',                cmd: 'shell atrace --list_categories' },
      { label: 'Atrace 10s (gfx input view wm)',      cmd: 'shell atrace -c -b 4096 gfx input view wm am --duration 10' },
      { label: 'Last ANR trace',                      cmd: 'shell cat /data/anr/anr_latest.txt' },
      { label: 'List ANR traces',                     cmd: 'shell ls -la /data/anr/' },
      { label: 'List tombstones (native crashes)',     cmd: 'shell ls -la /data/tombstones/' },
      { label: 'Last tombstone',                      cmd: 'shell cat /data/tombstones/tombstone_00' },
      { label: 'System log (/var/log)',                cmd: 'shell ls /var/log' },
      { label: 'Last panic log',                      cmd: 'shell cat /sys/fs/pstore/console-ramoops-0' },
      { label: 'Ramoops (last reboot log)',            cmd: 'shell ls /sys/fs/pstore/' },
      { label: 'StrictMode violations in logcat',     cmd: 'logcat -d | grep StrictMode' },
      { label: 'OOM kills in logcat',                 cmd: 'logcat -d | grep -i "low on memory"' },
      {
        label: 'Logcat filter by tag',
        cmd: 'logcat -d -s <tag>',
        needsInput: [{ placeholder: 'ActivityManager', token: '<tag>' }],
      },
      {
        label: 'Logcat filter by package (pid)',
        cmd: 'logcat -d --pid=<pid>',
        needsInput: [{ placeholder: '1234', token: '<pid>' }],
      },
      {
        label: 'Dropbox entry detail',
        cmd: 'shell dumpsys dropbox --print <entry>',
        needsInput: [{ placeholder: 'system_app_anr', token: '<entry>' }],
      },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'File System',
    commands: [
      { label: 'List /sdcard',                        cmd: 'shell ls -la /sdcard' },
      { label: 'List /data app directories',          cmd: 'shell ls -la /data/app' },
      { label: 'List /data/data (app data)',           cmd: 'shell ls -la /data/data' },
      { label: 'List /system/app',                    cmd: 'shell ls -la /system/app' },
      { label: 'List /system/priv-app',               cmd: 'shell ls -la /system/priv-app' },
      { label: 'List /vendor/app',                    cmd: 'shell ls -la /vendor/app' },
      { label: 'List /product/app',                   cmd: 'shell ls -la /product/app' },
      { label: 'List /apex',                          cmd: 'shell ls -la /apex' },
      { label: 'List /data/adb (Magisk)',              cmd: 'shell ls -la /data/adb' },
      { label: 'Storage free space (df)',              cmd: 'shell df -h' },
      { label: 'File system metadata /system',        cmd: 'shell stat /system' },
      { label: 'Hash check build.prop',               cmd: 'shell md5sum /system/build.prop' },
      { label: 'Read build.prop',                     cmd: 'shell cat /system/build.prop' },
      { label: 'Read default.prop',                   cmd: 'shell cat /default.prop' },
      { label: 'Read /proc/mounts',                   cmd: 'shell cat /proc/mounts' },
      { label: 'Find files in /data (depth 3)',        cmd: 'shell find /data -type f -maxdepth 3' },
      { label: 'Find SUID binaries (root)',            cmd: 'shell find / -perm -4000 -type f 2>/dev/null' },
      { label: 'Find world-writable files /data',     cmd: 'shell find /data -perm -o+w -type f 2>/dev/null' },
      { label: 'Disk usage /data',                    cmd: 'shell du -sh /data/*' },
      { label: 'Disk usage /sdcard',                  cmd: 'shell du -sh /sdcard/*' },
      { label: 'Mount points',                        cmd: 'shell mount' },
      { label: 'Block devices',                       cmd: 'shell ls -la /dev/block' },
      { label: 'Block device by-name links',          cmd: 'shell ls -la /dev/block/bootdevice/by-name' },
      { label: 'Check if /system is remounted rw',    cmd: 'shell mount | grep system' },
      { label: 'Inode usage',                         cmd: 'shell df -i' },
      { label: 'File type of path',
        cmd: 'shell file <path>',
        needsInput: [{ placeholder: '/sdcard/file.bin', token: '<path>' }] },
      { label: 'MD5 checksum of file',
        cmd: 'shell md5sum <path>',
        needsInput: [{ placeholder: '/sdcard/file.apk', token: '<path>' }] },
      { label: 'SHA256 checksum of file',
        cmd: 'shell sha256sum <path>',
        needsInput: [{ placeholder: '/sdcard/file.apk', token: '<path>' }] },
      { label: 'Hex dump of file (first 256 bytes)',
        cmd: 'shell xxd -l 256 <path>',
        needsInput: [{ placeholder: '/sdcard/file.bin', token: '<path>' }] },
      { label: 'Strings in binary',
        cmd: 'shell strings <path>',
        needsInput: [{ placeholder: '/system/bin/app_process', token: '<path>' }] },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Settings & Config',
    commands: [
      { label: 'System settings list',                cmd: 'shell settings list system' },
      { label: 'Secure settings list',                cmd: 'shell settings list secure' },
      { label: 'Global settings list',                cmd: 'shell settings list global' },
      { label: 'Get airplane mode',                   cmd: 'shell settings get global airplane_mode_on' },
      { label: 'Enable airplane mode',                cmd: 'shell settings put global airplane_mode_on 1' },
      { label: 'Disable airplane mode',               cmd: 'shell settings put global airplane_mode_on 0' },
      { label: 'Get screen timeout (ms)',              cmd: 'shell settings get system screen_off_timeout' },
      { label: 'Set screen timeout to 10min',         cmd: 'shell settings put system screen_off_timeout 600000' },
      { label: 'Get auto-brightness',                 cmd: 'shell settings get system screen_brightness_mode' },
      { label: 'Get screen brightness',               cmd: 'shell settings get system screen_brightness' },
      { label: 'Set screen brightness (0-255)',        cmd: 'shell settings put system screen_brightness 128' },
      { label: 'Get stay-awake setting',              cmd: 'shell settings get global stay_on_while_plugged_in' },
      { label: 'Keep awake while charging',           cmd: 'shell settings put global stay_on_while_plugged_in 3' },
      { label: 'Get install unknown sources',         cmd: 'shell settings get secure install_non_market_apps' },
      { label: 'Enable install unknown sources',      cmd: 'shell settings put secure install_non_market_apps 1' },
      { label: 'Get development settings enabled',    cmd: 'shell settings get global development_settings_enabled' },
      { label: 'Get USB debugging enabled',           cmd: 'shell settings get global adb_enabled' },
      { label: 'Get animation scale (window)',         cmd: 'shell settings get global window_animation_scale' },
      { label: 'Disable animations (all)',            cmd: 'shell settings put global window_animation_scale 0; shell settings put global transition_animation_scale 0; shell settings put global animator_duration_scale 0' },
      { label: 'Enable animations (restore)',         cmd: 'shell settings put global window_animation_scale 1; shell settings put global transition_animation_scale 1; shell settings put global animator_duration_scale 1' },
      { label: 'Get font scale',                      cmd: 'shell settings get system font_scale' },
      { label: 'Get USB config mode',                 cmd: 'shell getprop sys.usb.config' },
      { label: 'Set USB to MTP mode',                 cmd: 'shell setprop sys.usb.config mtp,adb' },
      { label: 'Show device policy info',             cmd: 'shell dpm list-owners' },
      { label: 'Remove device owner (root)',          cmd: 'shell dpm remove-active-admin com.example/.AdminReceiver' },
      {
        label: 'Get setting value',
        cmd: 'shell settings get global <key>',
        needsInput: [{ placeholder: 'wifi_on', token: '<key>' }],
      },
      {
        label: 'Put global setting',
        cmd: 'shell settings put global <key> <value>',
        needsInput: [
          { placeholder: 'wifi_on', token: '<key>' },
          { placeholder: '1', token: '<value>' },
        ],
      },
      {
        label: 'Put secure setting',
        cmd: 'shell settings put secure <key> <value>',
        needsInput: [
          { placeholder: 'android_id', token: '<key>' },
          { placeholder: 'value', token: '<value>' },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Fastboot',
    commands: [
      { label: 'List fastboot devices',               cmd: 'fastboot devices' },
      { label: 'Get all device variables',            cmd: 'fastboot getvar all' },
      { label: 'Get product name',                    cmd: 'fastboot getvar product' },
      { label: 'Get bootloader version',              cmd: 'fastboot getvar version-bootloader' },
      { label: 'Get baseband version',                cmd: 'fastboot getvar version-baseband' },
      { label: 'Get current slot (A/B)',               cmd: 'fastboot getvar current-slot' },
      { label: 'Get slot-count',                      cmd: 'fastboot getvar slot-count' },
      { label: 'Get slot-successful (a)',              cmd: 'fastboot getvar slot-successful:a' },
      { label: 'Get slot-successful (b)',              cmd: 'fastboot getvar slot-successful:b' },
      { label: 'Get slot-unbootable (a)',              cmd: 'fastboot getvar slot-unbootable:a' },
      { label: 'Get slot-unbootable (b)',              cmd: 'fastboot getvar slot-unbootable:b' },
      { label: 'Get is-logical (super)',               cmd: 'fastboot getvar is-logical:super' },
      { label: 'Get max-download-size',               cmd: 'fastboot getvar max-download-size' },
      { label: 'Get unlocked state',                  cmd: 'fastboot getvar unlocked' },
      { label: 'Get unlock ability',                  cmd: 'fastboot flashing get_unlock_ability' },
      { label: 'Unlock bootloader',                   cmd: 'fastboot flashing unlock' },
      { label: 'Lock bootloader',                     cmd: 'fastboot flashing lock' },
      { label: 'Unlock critical partitions',          cmd: 'fastboot flashing unlock_critical' },
      { label: 'Lock critical partitions',            cmd: 'fastboot flashing lock_critical' },
      { label: 'OEM unlock',                          cmd: 'fastboot oem unlock' },
      { label: 'OEM lock',                            cmd: 'fastboot oem lock' },
      { label: 'OEM device-info',                     cmd: 'fastboot oem device-info' },
      { label: 'OEM esim_erase',                      cmd: 'fastboot oem esim_erase' },
      { label: 'OEM esim_erase_factory',              cmd: 'fastboot oem esim_erase_factory' },
      { label: 'OEM get-identifier-token',            cmd: 'fastboot oem get-identifier-token' },
      { label: 'OEM off-mode-charge 0',               cmd: 'fastboot oem off-mode-charge 0' },
      { label: 'OEM off-mode-charge 1',               cmd: 'fastboot oem off-mode-charge 1' },
      { label: 'OEM enable uart (Pixel)',              cmd: 'fastboot oem uart enable' },
      { label: 'OEM disable uart (Pixel)',             cmd: 'fastboot oem uart disable' },
      { label: 'Reboot device',                       cmd: 'fastboot reboot' },
      { label: 'Reboot to bootloader',                cmd: 'fastboot reboot-bootloader' },
      { label: 'Reboot to fastbootd (userspace)',      cmd: 'fastboot reboot fastboot' },
      { label: 'Reboot to recovery',                  cmd: 'fastboot reboot recovery' },
      { label: 'Set active slot A',                   cmd: 'fastboot --set-active=a' },
      { label: 'Set active slot B',                   cmd: 'fastboot --set-active=b' },
      { label: 'Erase userdata partition',            cmd: 'fastboot erase userdata' },
      { label: 'Erase cache partition',               cmd: 'fastboot erase cache' },
      { label: 'Format userdata (ext4)',               cmd: 'fastboot format:ext4 userdata' },
      { label: 'Wipe userdata (-w)',                   cmd: 'fastboot -w' },
      { label: 'List logical partitions (fastbootd)',  cmd: 'fastboot getvar is-logical:system' },
      { label: 'Create logical partition',
        cmd: 'fastboot create-logical-partition <name> <size>',
        needsInput: [
          { placeholder: 'system_ext', token: '<name>' },
          { placeholder: '1073741824', token: '<size>' },
        ] },
      { label: 'Delete logical partition',
        cmd: 'fastboot delete-logical-partition <name>',
        needsInput: [{ placeholder: 'system_ext', token: '<name>' }] },
      { label: 'Resize logical partition',
        cmd: 'fastboot resize-logical-partition <name> <size>',
        needsInput: [
          { placeholder: 'system', token: '<name>' },
          { placeholder: '2147483648', token: '<size>' },
        ] },
      { label: 'Flash boot image',
        cmd: 'fastboot flash boot <file>',
        needsInput: [{ placeholder: '/path/to/boot.img', token: '<file>' }] },
      { label: 'Flash boot image (--force)',
        cmd: 'fastboot --force flash boot <file>',
        needsInput: [{ placeholder: '/path/to/boot.img', token: '<file>' }] },
      { label: 'Flash recovery image',
        cmd: 'fastboot flash recovery <file>',
        needsInput: [{ placeholder: '/path/to/recovery.img', token: '<file>' }] },
      { label: 'Flash vbmeta (disable verity)',
        cmd: 'fastboot --disable-verity --disable-verification flash vbmeta <file>',
        needsInput: [{ placeholder: '/path/to/vbmeta.img', token: '<file>' }] },
      { label: 'Boot image (one-time, no flash)',
        cmd: 'fastboot boot <file>',
        needsInput: [{ placeholder: '/path/to/boot.img', token: '<file>' }] },
      { label: 'Update from zip (with wipe)',          cmd: 'fastboot -w update <file>',
        needsInput: [{ placeholder: '/path/to/image.zip', token: '<file>' }] },
      { label: 'Fastboot verbose mode',               cmd: 'fastboot --verbose getvar all' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Root & Magisk',
    commands: [
      { label: 'Check if rooted (su)',                cmd: 'shell which su' },
      { label: 'Check su binary location',            cmd: 'shell find / -name su -type f 2>/dev/null' },
      { label: 'Run id as root',                      cmd: 'shell su -c id' },
      { label: 'Check Magisk app installed',          cmd: 'shell pm list packages | grep magisk' },
      { label: 'Magisk version',                      cmd: 'shell magisk -v' },
      { label: 'Magisk version code',                 cmd: 'shell magisk -V' },
      { label: 'Magisk daemon status',                cmd: 'shell magisk --daemon' },
      { label: 'List Magisk modules',                 cmd: 'shell ls /data/adb/modules' },
      { label: 'List Magisk modules (details)',        cmd: 'shell ls -la /data/adb/modules' },
      { label: 'Read module properties',
        cmd: 'shell cat /data/adb/modules/<module>/module.prop',
        needsInput: [{ placeholder: 'module_name', token: '<module>' }] },
      { label: 'Disable Magisk module',
        cmd: 'shell touch /data/adb/modules/<module>/disable',
        needsInput: [{ placeholder: 'module_name', token: '<module>' }] },
      { label: 'Enable Magisk module',
        cmd: 'shell rm /data/adb/modules/<module>/disable',
        needsInput: [{ placeholder: 'module_name', token: '<module>' }] },
      { label: 'Check KernelSU presence',             cmd: 'shell which ksud' },
      { label: 'KernelSU version',                    cmd: 'shell ksud --version' },
      { label: 'Check APatch presence',               cmd: 'shell ls /data/adb/ap' },
      { label: 'Root all apps (Magisk)',               cmd: 'shell magisk --sqlite "UPDATE policies SET policy=2 WHERE 1"' },
      { label: 'Magisk hide list',                    cmd: 'shell magisk --sqlite "SELECT * FROM hidelist"' },
      { label: 'Zygisk enabled check',                cmd: 'shell magisk --sqlite "SELECT value FROM settings WHERE key=\'zygisk\'"' },
      { label: 'List Magisk deny list',               cmd: 'shell magisk --denylist ls' },
      { label: 'Mount /system as rw (root)',           cmd: 'shell su -c "mount -o remount,rw /system"' },
      { label: 'Mount /vendor as rw (root)',           cmd: 'shell su -c "mount -o remount,rw /vendor"' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Instrumentation & Testing',
    commands: [
      { label: 'List instrumentations',               cmd: 'shell pm list instrumentation' },
      { label: 'Run UI automator tests',
        cmd: 'shell am instrument -w <package>/androidx.test.runner.AndroidJUnitRunner',
        needsInput: [{ placeholder: 'com.example.test', token: '<package>' }] },
      { label: 'Monkey random events (1000)',
        cmd: 'shell monkey -p <package> --throttle 100 1000',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }] },
      { label: 'Monkey with seed',
        cmd: 'shell monkey -p <package> -s 12345 1000',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }] },
      { label: 'Tap at coordinates',
        cmd: 'shell input tap <x> <y>',
        needsInput: [
          { placeholder: '540', token: '<x>' },
          { placeholder: '960', token: '<y>' },
        ] },
      { label: 'Long press at coordinates',
        cmd: 'shell input swipe <x> <y> <x> <y> 1000',
        needsInput: [
          { placeholder: '540', token: '<x>' },
          { placeholder: '960', token: '<y>' },
        ] },
      { label: 'Type text',
        cmd: 'shell input text <text>',
        needsInput: [{ placeholder: 'hello_world', token: '<text>' }] },
      { label: 'Open URL in browser',
        cmd: 'shell am start -a android.intent.action.VIEW -d <url>',
        needsInput: [{ placeholder: 'https://example.com', token: '<url>' }] },
      { label: 'Open app settings page',
        cmd: 'shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:<package>',
        needsInput: [{ placeholder: 'com.example.app', token: '<package>' }] },
      { label: 'Simulate incoming call',
        cmd: 'shell am start -a android.intent.action.CALL -d tel:<number>',
        needsInput: [{ placeholder: '+1234567890', token: '<number>' }] },
      { label: 'Simulate SMS received',
        cmd: 'shell am broadcast -a android.provider.Telephony.SMS_RECEIVED' },
      { label: 'Trigger low battery broadcast',
        cmd: 'shell am broadcast -a android.intent.action.BATTERY_LOW' },
      { label: 'Trigger power connected broadcast',
        cmd: 'shell am broadcast -a android.intent.action.ACTION_POWER_CONNECTED' },
      { label: 'Trigger boot completed broadcast',
        cmd: 'shell am broadcast -a android.intent.action.BOOT_COMPLETED' },
      { label: 'Trigger screen on broadcast',
        cmd: 'shell am broadcast -a android.intent.action.SCREEN_ON' },
      { label: 'StrictMode violations in logcat',     cmd: 'logcat -d | grep StrictMode' },
      { label: 'Systrace (10s gfx)',
        cmd: 'shell systrace gfx -t 10 -o /sdcard/trace.html' },
      { label: 'Perfetto trace (5s)',
        cmd: 'shell perfetto --out /sdcard/trace.pftrace --time 5s' },
    ],
  },

  // ─────────────────────────────────────────────
  {
    name: 'Reboot',
    commands: [
      { label: 'Reboot to system',                    cmd: 'reboot' },
      { label: 'Reboot to recovery',                  cmd: 'reboot recovery' },
      { label: 'Reboot to bootloader',                cmd: 'reboot bootloader' },
      { label: 'Reboot to fastboot',                  cmd: 'reboot fastboot' },
      { label: 'Reboot to sideload',                  cmd: 'reboot sideload' },
      { label: 'Soft reboot (kill zygote)',            cmd: 'shell setprop ctl.restart zygote' },
      { label: 'Remount system (root)',                cmd: 'remount' },
    ],
  },
]

export default function ViewUtilities() {
  const [output, setOutput]           = useState('')
  const [outputLabel, setOutputLabel] = useState('')
  const [running, setRunning]         = useState(false)
  const [openCats, setOpenCats]       = useState<Set<string>>(new Set(['Device Info']))
  const [inputs, setInputs]           = useState<Record<string, string>>({})
  const [copied, setCopied]           = useState(false)
  const [activeCmd, setActiveCmd]     = useState<Command | null>(null)
  const [search, setSearch]           = useState('')

  const totalCmds = CATEGORIES.reduce((a, c) => a + c.commands.length, 0)

  const filteredCategories = CATEGORIES.map(cat => ({
    ...cat,
    commands: search
      ? cat.commands.filter(c =>
          c.label.toLowerCase().includes(search.toLowerCase()) ||
          c.cmd.toLowerCase().includes(search.toLowerCase()))
      : cat.commands,
  })).filter(cat => cat.commands.length > 0)

  const toggleCat = (name: string) => {
    setOpenCats(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const expandAll = () => setOpenCats(new Set(CATEGORIES.map(c => c.name)))
  const collapseAll = () => setOpenCats(new Set())

  const resolveCmd = (cmd: Command): string | null => {
    let resolved = cmd.cmd
    if (cmd.needsInput) {
      for (const field of cmd.needsInput) {
        const val = (inputs[field.token] || '').trim()
        if (!val) return null
        resolved = resolved.replace(field.token, val)
      }
    }
    return resolved
  }

  const runCommand = async (cmd: Command) => {
    if (cmd.needsInput) {
      const allFilled = cmd.needsInput.every(f => (inputs[f.token] || '').trim())
      if (!allFilled) { setActiveCmd(cmd); return }
    }

    // Reboot commands go through the proper Reboot() call
    if (cmd.cmd.startsWith('reboot')) {
      const mode = cmd.cmd.replace('reboot', '').trim()
      if (mode && !confirm(`Reboot to ${cmd.label}?`)) return
      const id = notify.loading('Rebooting...')
      try {
        await Reboot(mode)
        notify.dismiss(id)
        notify.success(`${cmd.label} initiated`)
      } catch (e: any) {
        notify.dismiss(id)
        notify.error(e)
      }
      return
    }

    const resolved = resolveCmd(cmd)
    if (!resolved) { setActiveCmd(cmd); return }

    setRunning(true)
    setOutputLabel(cmd.label)
    setOutput('')

    try {
      const out = await RunAdbHostCommand(resolved)
      setOutput(out || '(no output)')
    } catch (e: any) {
      setOutput(`Error: ${String(e)}`)
    } finally {
      setRunning(false)
      setActiveCmd(null)
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: command browser */}
      <div className="w-80 shrink-0 border-r border-bg-border flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-bg-border shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-title">Command Library</p>
              <p className="text-text-muted text-xs mt-0.5">{totalCmds} commands · {CATEGORIES.length} categories</p>
            </div>
            <div className="flex gap-1">
              <button onClick={expandAll} className="btn-ghost text-xs py-0.5 px-1.5">All</button>
              <button onClick={collapseAll} className="btn-ghost text-xs py-0.5 px-1.5">None</button>
            </div>
          </div>
          <input
            className="input text-xs w-full"
            placeholder="Search commands..."
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              if (e.target.value) expandAll()
            }}
          />
        </div>

        <div className="flex-1 overflow-auto">
          {filteredCategories.map(cat => (
            <div key={cat.name} className="border-b border-bg-border/40">
              <button
                onClick={() => toggleCat(cat.name)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-raised transition-colors"
              >
                <div className="flex items-center gap-2">
                  {openCats.has(cat.name)
                    ? <ChevronDown size={12} className="text-accent-green shrink-0" />
                    : <ChevronRight size={12} className="text-text-muted shrink-0" />
                  }
                  <span className="text-xs font-medium text-text-primary">{cat.name}</span>
                </div>
                <span className="text-xs text-text-muted">{cat.commands.length}</span>
              </button>

              {openCats.has(cat.name) && (
                <div className="pb-1">
                  {cat.commands.map(cmd => (
                    <div
                      key={cmd.label}
                      className="group flex items-start gap-1 mx-2 rounded px-2 py-1.5 hover:bg-bg-raised transition-colors cursor-pointer"
                      onClick={() => runCommand(cmd)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs text-text-secondary truncate">{cmd.label}</p>
                          {cmd.needsInput && (
                            <span className="badge-yellow shrink-0 text-xs">args</span>
                          )}
                        </div>
                        <p className="text-xs mono text-text-muted truncate leading-tight mt-0.5">
                          {cmd.cmd}
                        </p>
                      </div>
                      <Play
                        size={11}
                        className="opacity-0 group-hover:opacity-100 text-accent-green shrink-0 mt-0.5 transition-opacity"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: output */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Arg prompt */}
        {activeCmd?.needsInput && (
          <div className="border-b border-bg-border bg-bg-raised px-4 py-3 space-y-2 shrink-0">
            <p className="text-xs font-medium text-text-primary">{activeCmd.label}</p>
            <p className="mono text-xs text-text-muted">{activeCmd.cmd}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {activeCmd.needsInput.map(field => (
                <div key={field.token} className="flex items-center gap-2">
                  <span className="badge-yellow text-xs">{field.token}</span>
                  <input
                    autoFocus
                    className="input text-xs w-52"
                    placeholder={field.placeholder}
                    value={inputs[field.token] || ''}
                    onChange={e => setInputs(prev => ({ ...prev, [field.token]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && runCommand(activeCmd)}
                  />
                </div>
              ))}
              <button onClick={() => runCommand(activeCmd)} className="btn-primary text-xs">
                <Play size={12} /> Run
              </button>
              <button onClick={() => { setActiveCmd(null); setInputs({}) }} className="btn-ghost text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Output header */}
        <div className="border-b border-bg-border px-4 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={13} className="text-accent-green" />
            <span className="text-xs text-text-secondary">
              {outputLabel || 'Output — click any command to run it'}
            </span>
            {running && (
              <div className="w-3 h-3 border border-accent-green border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          {output && (
            <button onClick={copyOutput} className="btn-ghost text-xs">
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          )}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-auto p-4 bg-bg-base">
          {!output && !running && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
              <Wrench size={32} className="opacity-20" />
              <p className="text-sm">Select a command from the panel</p>
              <p className="text-xs">Commands marked <span className="badge-yellow">args</span> prompt for input before running</p>
            </div>
          )}
          {output && (
            <pre className="text-xs mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
              {output}
            </pre>
          )}
        </div>

        {/* Status bar */}
        {output && (
          <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted shrink-0">
            <span>{outputLabel}</span>
            <span>{output.split('\n').length} lines · {output.length} chars</span>
          </div>
        )}
      </div>
    </div>
  )
}
