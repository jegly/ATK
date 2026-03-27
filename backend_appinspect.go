package main

import (
	"fmt"
	"strings"
)

type AppInspection struct {
	PackageName   string   `json:"packageName"`
	VersionName   string   `json:"versionName"`
	VersionCode   string   `json:"versionCode"`
	TargetSDK     string   `json:"targetSdk"`
	MinSDK        string   `json:"minSdk"`
	InstallPath   string   `json:"installPath"`
	DataDir       string   `json:"dataDir"`
	Installer     string   `json:"installer"`
	FirstInstall  string   `json:"firstInstall"`
	LastUpdated   string   `json:"lastUpdated"`
	IsSystem      bool     `json:"isSystem"`
	IsEnabled     bool     `json:"isEnabled"`
	IsDebuggable  bool     `json:"isDebuggable"`
	UID           string   `json:"uid"`
	Permissions   []string `json:"permissions"`
	Activities    []string `json:"activities"`
	Services      []string `json:"services"`
	Receivers     []string `json:"receivers"`
	Providers     []string `json:"providers"`
	NativeLibs    []string `json:"nativeLibs"`
	SharedLibs    []string `json:"sharedLibs"`
	CertSubject   string   `json:"certSubject"`
	CertIssuer    string   `json:"certIssuer"`
	CertExpiry    string   `json:"certExpiry"`
	CertSHA256    string   `json:"certSha256"`
	ManifestDump  string   `json:"manifestDump"`
}

// InspectApp returns deep information about an installed package.
func (a *App) InspectApp(packageName string) (AppInspection, error) {
	if err := validatePackageName(packageName); err != nil {
		return AppInspection{}, err
	}

	result := AppInspection{PackageName: packageName}

	// Full package dump
	dump, err := a.runAdbShellTimeout(30*1e9, "dumpsys", "package", packageName)
	if err != nil {
		return result, fmt.Errorf("failed to dump package: %w", err)
	}

	result.ManifestDump = dump

	// Parse key fields from dump
	for _, line := range strings.Split(dump, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "versionName="):
			result.VersionName = strings.TrimPrefix(line, "versionName=")
		case strings.HasPrefix(line, "versionCode="):
			parts := strings.Fields(line)
			if len(parts) > 0 {
				result.VersionCode = strings.TrimPrefix(parts[0], "versionCode=")
			}
		case strings.HasPrefix(line, "targetSdk="):
			result.TargetSDK = strings.TrimPrefix(line, "targetSdk=")
		case strings.HasPrefix(line, "minSdk="):
			result.MinSDK = strings.TrimPrefix(line, "minSdk=")
		case strings.HasPrefix(line, "codePath="):
			result.InstallPath = strings.TrimPrefix(line, "codePath=")
		case strings.HasPrefix(line, "dataDir="):
			result.DataDir = strings.TrimPrefix(line, "dataDir=")
		case strings.HasPrefix(line, "installerPackageName="):
			result.Installer = strings.TrimPrefix(line, "installerPackageName=")
		case strings.HasPrefix(line, "firstInstallTime="):
			result.FirstInstall = strings.TrimPrefix(line, "firstInstallTime=")
		case strings.HasPrefix(line, "lastUpdateTime="):
			result.LastUpdated = strings.TrimPrefix(line, "lastUpdateTime=")
		case strings.HasPrefix(line, "pkgFlags="):
			flags := line
			result.IsSystem = strings.Contains(flags, "SYSTEM")
			result.IsDebuggable = strings.Contains(flags, "DEBUGGABLE")
		case strings.HasPrefix(line, "userId="):
			result.UID = strings.TrimPrefix(line, "userId=")
		case strings.HasPrefix(line, "enabledState="):
			result.IsEnabled = strings.Contains(line, "ENABLED") && !strings.Contains(line, "DISABLED")
		}
	}

	// Granted permissions
	perms, _ := a.runAdbShell("dumpsys", "package", packageName)
	inPerms := false
	for _, line := range strings.Split(perms, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "granted=true") || strings.Contains(trimmed, "install permissions:") {
			inPerms = true
		}
		if inPerms && strings.HasPrefix(trimmed, "android.permission.") {
			perm := strings.Split(trimmed, ":")[0]
			result.Permissions = append(result.Permissions, perm)
		}
		if inPerms && trimmed == "" {
			inPerms = false
		}
	}

	// Activities, services, receivers, providers via pm dump
	pmDump, _ := a.runAdbShell("pm", "dump", packageName)
	section := ""
	for _, line := range strings.Split(pmDump, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.Contains(trimmed, "Activity Resolver Table"):
			section = "activities"
		case strings.Contains(trimmed, "Service Resolver Table"):
			section = "services"
		case strings.Contains(trimmed, "Receiver Resolver Table"):
			section = "receivers"
		case strings.Contains(trimmed, "Provider Resolver Table"):
			section = "providers"
		case strings.Contains(trimmed, "Key Set Manager"):
			section = ""
		}

		if section != "" && strings.Contains(trimmed, packageName+"/") {
			parts := strings.Fields(trimmed)
			for _, p := range parts {
				if strings.Contains(p, packageName+"/") {
					className := strings.Split(p, "/")[1]
					switch section {
					case "activities":
						result.Activities = appendUnique(result.Activities, className)
					case "services":
						result.Services = appendUnique(result.Services, className)
					case "receivers":
						result.Receivers = appendUnique(result.Receivers, className)
					case "providers":
						result.Providers = appendUnique(result.Providers, className)
					}
				}
			}
		}
	}

	// Native libraries
	apkPath := strings.TrimPrefix(strings.TrimSpace(result.InstallPath), "package:")
	if apkPath != "" {
		libOut, _ := a.runAdbShell("unzip", "-l", apkPath+"/base.apk")
		for _, line := range strings.Split(libOut, "\n") {
			if strings.Contains(line, "lib/") && strings.HasSuffix(line, ".so") {
				parts := strings.Fields(line)
				if len(parts) > 0 {
					result.NativeLibs = appendUnique(result.NativeLibs, parts[len(parts)-1])
				}
			}
		}
	}

	// Certificate info via apksigner or keytool
	certOut, _ := a.runAdbShell("pm", "dump", packageName)
	for _, line := range strings.Split(certOut, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "Signing certificates:") {
			// next lines have cert info
		}
		if strings.HasPrefix(trimmed, "Subject:") {
			result.CertSubject = strings.TrimPrefix(trimmed, "Subject: ")
		}
		if strings.HasPrefix(trimmed, "Issuer:") {
			result.CertIssuer = strings.TrimPrefix(trimmed, "Issuer: ")
		}
	}

	return result, nil
}

func appendUnique(slice []string, item string) []string {
	for _, s := range slice {
		if s == item {
			return slice
		}
	}
	return append(slice, item)
}
