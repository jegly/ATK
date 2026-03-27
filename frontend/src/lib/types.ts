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

export interface LogcatLine {
  raw: string
  level: string
  tag: string
  message: string
  pid: string
  time: string
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
  | 'packages'
  | 'debloater'
  | 'shell'
  | 'logcat'
  | 'appinspect'
  | 'certs'
  | 'backup'
  | 'props'
  | 'flasher'
  | 'pixelflasher'
  | 'utilities'
  | 'settings'
