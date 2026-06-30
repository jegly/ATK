export interface Device {
  serial: string
  status: string
}

export interface DeviceInfo {
  model: string
  androidVersion: string
  buildNumber: string
  batteryLevel: string
  serial: string
  ipAddress: string
  rootStatus: string
  codename: string
  ramTotal: string
  storageInfo: string
  brand: string
  deviceName: string
  securityPatch: string
  uptime: string
  bootloaderStatus: string
  screenResolution: string
  basebandVersion: string
  kernelVersion: string
  cpuArch: string
}

export interface FileEntry {
  name: string
  type: 'File' | 'Directory' | 'Symlink'
  size: string
  permissions: string
  date: string
  time: string
}

export interface PackageInfo {
  packageName: string
  isEnabled: boolean
}

// Relationship kinds mined (in Go) from a log line for the visual map.
export type RefKind = 'activity' | 'spawn' | 'death' | 'crash' | 'anr' | 'signal' | 'gfx' | 'mention'
export interface LogRef {
  kind: RefKind
  target: string
  targetKind: 'package' | 'component' | 'pid'
}

export interface LogcatLine {
  raw: string
  level: string
  tag: string
  message: string
  pid: string
  tid?: string
  time: string
  refs?: LogRef[]       // relationships mined natively by the Go backend
  mentions?: LogRef[]   // generic package mentions (optional/noisy)
}

export interface APKAuditPermission {
  name: string
  dangerous: boolean
}

export interface APKAuditComponent {
  type: string
  name: string
  exported: boolean
  exportedImplicit: boolean
  permission: string
  intentFilters: string[]
}

export interface APKAuditCert {
  verified: boolean
  subject: string
  issuer: string
  sigAlgo: string
  serial: string
  sha256: string
  sha1: string
  validFrom: string
  validTo: string
  v1: boolean
  v2: boolean
  v3: boolean
  isDebug: boolean
  expired: boolean
  weakAlgo: boolean
  error: string
}

export interface APKAuditFindingMatch {
  file: string
  value: string
}

export interface APKAuditFinding {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  description: string
  cwe: string
  masvs: string
  confidence: number
  matches: APKAuditFindingMatch[]
}

export interface APKAuditTracker {
  name: string
  category: string
  matches: number
}

export interface APKAuditFile {
  path: string
  size: number
  compressed: number
}

export interface APKEntryContent {
  name: string
  size: number
  kind: 'text' | 'image' | 'binary'
  mime: string
  text: string
  base64: string
  hex: string
  truncated: boolean
}

export interface APKAudit {
  source: string
  path: string
  localPath: string
  fileName: string
  fileSize: number
  sha256: string
  packageName: string
  appLabel: string
  versionName: string
  versionCode: string
  minSdk: string
  targetSdk: string
  compileSdk: string
  debuggable: boolean
  allowBackup: boolean
  usesCleartext: boolean
  hasNetworkSecurityConfig: boolean
  permissions: APKAuditPermission[]
  components: APKAuditComponent[]
  cert: APKAuditCert
  findings: APKAuditFinding[]
  trackers: APKAuditTracker[]
  files: APKAuditFile[]
  manifestXml: string
  score: number
  grade: string
  counts: Record<string, number>
}

export interface AppInspection {
  packageName: string
  versionName: string
  versionCode: string
  targetSdk: string
  minSdk: string
  installPath: string
  dataDir: string
  installer: string
  firstInstall: string
  lastUpdated: string
  isSystem: boolean
  isEnabled: boolean
  isDebuggable: boolean
  uid: string
  permissions: string[]
  activities: string[]
  services: string[]
  receivers: string[]
  providers: string[]
  nativeLibs: string[]
  certSubject: string
  certIssuer: string
  certExpiry: string
  certSha256: string
  manifestDump: string
}

export interface CertInfo {
  filename: string
  subject: string
  issuer: string
  expiry: string
  fingerprint: string
  isUser: boolean
  isSystem: boolean
}

export interface PropEntry {
  key: string
  value: string
  category: string
}

export interface BackupOptions {
  includeApks: boolean
  includeShared: boolean
  includeSystem: boolean
  packages: string[]
  allApps: boolean
}

export type View =
  | 'dashboard'
  | 'files'
  | 'mirror'
  | 'packages'
  | 'debloater'
  | 'shell'
  | 'logcat'
  | 'appinspect'
  | 'apkaudit'
  | 'certs'
  | 'backup'
  | 'props'
  | 'flasher'
  | 'pixelflasher'
  | 'utilities'
  | 'settings'
