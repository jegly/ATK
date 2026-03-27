package main

import (
	"fmt"
	"strings"
	"time"
)

type CertInfo struct {
	Filename    string `json:"filename"`
	Subject     string `json:"subject"`
	Issuer      string `json:"issuer"`
	Expiry      string `json:"expiry"`
	Fingerprint string `json:"fingerprint"`
	IsUser      bool   `json:"isUser"`
	IsSystem    bool   `json:"isSystem"`
}

// ListSystemCerts returns all system CA certificates.
func (a *App) ListSystemCerts() ([]CertInfo, error) {
	return a.listCerts("/system/etc/security/cacerts", false)
}

// ListUserCerts returns user-installed CA certificates.
func (a *App) ListUserCerts() ([]CertInfo, error) {
	return a.listCerts("/data/misc/user/0/cacerts-added", true)
}

func (a *App) listCerts(path string, isUser bool) ([]CertInfo, error) {
	out, err := a.runAdbShell("ls", path)
	if err != nil || strings.TrimSpace(out) == "" {
		return nil, nil
	}

	var certs []CertInfo
	for _, fname := range strings.Fields(out) {
		fname = strings.TrimSpace(fname)
		if fname == "" || strings.HasPrefix(fname, "ls:") {
			continue
		}

		fullPath := path + "/" + fname
		certOut, err := a.runAdbShellTimeout(10*time.Second, "openssl", "x509",
			"-in", fullPath, "-noout", "-subject", "-issuer", "-enddate", "-fingerprint")

		info := CertInfo{
			Filename: fname,
			IsUser:   isUser,
			IsSystem: !isUser,
		}

		if err == nil {
			for _, line := range strings.Split(certOut, "\n") {
				line = strings.TrimSpace(line)
				switch {
				case strings.HasPrefix(line, "subject="):
					info.Subject = strings.TrimPrefix(line, "subject=")
				case strings.HasPrefix(line, "issuer="):
					info.Issuer = strings.TrimPrefix(line, "issuer=")
				case strings.HasPrefix(line, "notAfter="):
					info.Expiry = strings.TrimPrefix(line, "notAfter=")
				case strings.HasPrefix(line, "SHA1 Fingerprint="):
					info.Fingerprint = strings.TrimPrefix(line, "SHA1 Fingerprint=")
				case strings.HasPrefix(line, "SHA256 Fingerprint="):
					info.Fingerprint = strings.TrimPrefix(line, "SHA256 Fingerprint=")
				}
			}
		}

		certs = append(certs, info)
	}

	return certs, nil
}

// InstallUserCert installs a PEM certificate as a user-trusted CA.
// localCertPath is the path to the cert on the host machine.
func (a *App) InstallUserCert(localCertPath string) (string, error) {
	// Get the cert hash (used as filename by Android)
	// Push the cert to a temp location first
	remoteTmp := "/sdcard/tmp_cert.pem"
	_, err := a.runCommand("adb", "push", localCertPath, remoteTmp)
	if err != nil {
		return "", fmt.Errorf("failed to push cert: %w", err)
	}

	// Get the hash
	hashOut, err := a.runAdbShell("openssl", "x509", "-inform", "PEM",
		"-subject_hash_old", "-in", remoteTmp)
	if err != nil {
		return "", fmt.Errorf("failed to compute cert hash (is openssl on device?): %w", err)
	}

	hash := strings.TrimSpace(strings.Split(hashOut, "\n")[0])
	if hash == "" {
		return "", fmt.Errorf("could not compute certificate hash")
	}

	destPath := "/data/misc/user/0/cacerts-added/" + hash + ".0"

	// Requires root
	_, err = a.runAdbShell("su", "-c",
		fmt.Sprintf("cp %s %s && chmod 644 %s", remoteTmp, destPath, destPath))
	if err != nil {
		return "", fmt.Errorf("failed to install cert (root required): %w", err)
	}

	// Cleanup
	a.runAdbShell("rm", remoteTmp)

	return fmt.Sprintf("Certificate installed as %s.0 — you may need to reboot", hash), nil
}

// RemoveUserCert removes a user-installed CA certificate by filename.
func (a *App) RemoveUserCert(filename string) (string, error) {
	if strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		return "", fmt.Errorf("invalid certificate filename")
	}

	destPath := "/data/misc/user/0/cacerts-added/" + filename
	_, err := a.runAdbShell("su", "-c", "rm "+destPath)
	if err != nil {
		return "", fmt.Errorf("failed to remove cert (root required): %w", err)
	}

	return "Certificate removed: " + filename, nil
}

// SelectCertFile opens a file picker for PEM/CRT files.
func (a *App) SelectCertFile() (string, error) {
	return a.SelectFileWithFilter("Select CA Certificate", []string{"*.pem", "*.crt", "*.cer"})
}

// CheckPinning checks if an app has certificate pinning configured.
// This is a heuristic check based on known pinning libraries and manifest flags.
func (a *App) CheckPinning(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}

	results := []string{}

	// Check network security config
	dump, err := a.runAdbShell("dumpsys", "package", packageName)
	if err != nil {
		return "", fmt.Errorf("failed to dump package: %w", err)
	}

	if strings.Contains(dump, "networkSecurityConfig") {
		results = append(results, "⚠ networkSecurityConfig present — may have custom trust anchors or pinning")
	}

	// Check for known pinning libraries in the APK
	apkPath, _ := a.runAdbShell("pm", "path", packageName)
	apkPath = strings.TrimPrefix(strings.TrimSpace(apkPath), "package:")

	if apkPath != "" {
		zipList, _ := a.runAdbShell("unzip", "-l", apkPath)
		checks := map[string]string{
			"okhttp3":        "OkHttp3 — likely has CertificatePinner",
			"TrustKit":       "TrustKit — SSL pinning library",
			"conscrypt":      "Conscrypt — custom SSL provider",
			"PublicKeyPins":  "PublicKeyPins — HPKP style pinning",
			"pinning":        "pinning — generic pinning reference",
			"certificate_transparency": "Certificate Transparency enforced",
		}
		for keyword, desc := range checks {
			if strings.Contains(strings.ToLower(zipList), strings.ToLower(keyword)) {
				results = append(results, "⚠ "+desc)
			}
		}
	}

	if len(results) == 0 {
		return "No obvious pinning detected — but always verify with a proxy (Burp/mitmproxy)", nil
	}

	return strings.Join(results, "\n"), nil
}
