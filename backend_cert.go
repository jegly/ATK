package main

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os/exec"
	"strings"
	"sync"
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

	var names []string
	for _, fname := range strings.Fields(out) {
		fname = strings.TrimSpace(fname)
		if fname != "" && !strings.HasPrefix(fname, "ls:") {
			names = append(names, fname)
		}
	}

	// Devices don't ship `openssl`, so read each cert off the device and parse
	// it host-side with crypto/x509. Done in parallel — there can be 140+ certs.
	certs := make([]CertInfo, len(names))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, fname := range names {
		wg.Add(1)
		go func(i int, fname string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			info := CertInfo{Filename: fname, IsUser: isUser, IsSystem: !isUser}
			if data, derr := a.readDeviceFile(path + "/" + fname); derr == nil {
				fillCertInfo(&info, data)
			}
			certs[i] = info
		}(i, fname)
	}
	wg.Wait()
	return certs, nil
}

// readDeviceFile streams a (small) device file's raw bytes via adb exec-out.
func (a *App) readDeviceFile(path string) ([]byte, error) {
	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(adbPath, "exec-out", "cat", path)
	setCommandSysProcAttr(cmd)
	return cmd.Output()
}

// fillCertInfo parses a PEM/DER certificate and fills the friendly fields.
func fillCertInfo(info *CertInfo, data []byte) {
	der := data
	if block, _ := pem.Decode(data); block != nil {
		der = block.Bytes
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		return
	}
	info.Subject = friendlyName(c.Subject.CommonName, c.Subject.Organization, c.Subject.String())
	info.Issuer = friendlyName(c.Issuer.CommonName, c.Issuer.Organization, c.Issuer.String())
	info.Expiry = c.NotAfter.Format("2006-01-02")
	sum := sha256.Sum256(c.Raw)
	info.Fingerprint = hex.EncodeToString(sum[:])
}

func friendlyName(cn string, org []string, full string) string {
	if cn != "" {
		return cn
	}
	if len(org) > 0 && org[0] != "" {
		return org[0]
	}
	return full
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
