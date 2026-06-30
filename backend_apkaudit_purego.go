package main

// Pure-Go fallback parsers for the APK auditor, used when the Android SDK
// build-tools (aapt2 / apksigner) or a JDK are not installed. This makes the
// audit fully self-contained for users who only have adb/fastboot.
//
// Reference path (aapt2 + apksigner) stays the default when those tools are
// present; these functions are only invoked as a fallback.

import (
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"strings"
	"time"

	"github.com/avast/apkparser"
	"github.com/avast/apkverifier"
)

// hasBuildTool reports whether a build-tool can be resolved on this machine.
func (a *App) hasBuildTool(name string) bool {
	_, err := a.resolveBuildTool(name)
	return err == nil
}

// parseManifestGo decodes the binary AndroidManifest.xml with apkparser and
// fills the same audit fields the aapt2 path would (minus the resource-resolved
// app label, which needs the resource table).
func parseManifestGo(path string, audit *APKAudit) {
	var buf bytes.Buffer
	enc := xml.NewEncoder(&buf)
	enc.Indent("", "  ")
	zipErr, _, _ := apkparser.ParseApk(path, enc)
	_ = enc.Flush()
	if zipErr != nil {
		return
	}
	audit.ManifestXML = buf.String()

	dec := xml.NewDecoder(strings.NewReader(audit.ManifestXML))
	compIdx := -1
	allowBackupSeen, cleartextSeen := false, false

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			attr := func(k string) string {
				for _, a := range t.Attr {
					if a.Name.Local == k {
						return a.Value
					}
				}
				return ""
			}
			has := func(k string) bool {
				for _, a := range t.Attr {
					if a.Name.Local == k {
						return true
					}
				}
				return false
			}

			switch t.Name.Local {
			case "manifest":
				audit.PackageName = attr("package")
				if v := attr("versionName"); v != "" {
					audit.VersionName = v
				}
				if v := attr("versionCode"); v != "" {
					audit.VersionCode = v
				}
				if v := attr("compileSdkVersion"); v != "" {
					audit.CompileSDK = v
				}
			case "uses-sdk":
				if v := attr("minSdkVersion"); v != "" {
					audit.MinSDK = v
				}
				if v := attr("targetSdkVersion"); v != "" {
					audit.TargetSDK = v
				}
			case "uses-permission", "uses-permission-sdk-23":
				if n := attr("name"); n != "" {
					audit.Permissions = append(audit.Permissions, Permission{Name: n, Dangerous: dangerousPermissions[n]})
				}
			case "application":
				if has("debuggable") {
					audit.Debuggable = isTrue(attr("debuggable"))
				}
				if has("allowBackup") {
					allowBackupSeen = true
					audit.AllowBackup = isTrue(attr("allowBackup"))
				}
				if has("usesCleartextTraffic") {
					cleartextSeen = true
					audit.UsesCleartext = isTrue(attr("usesCleartextTraffic"))
				}
				if has("networkSecurityConfig") {
					audit.HasNSC = true
				}
			case "activity", "activity-alias", "service", "receiver", "provider":
				typ := t.Name.Local
				if typ == "activity-alias" {
					typ = "activity"
				}
				c := Component{Type: typ, Name: attr("name"), Permission: attr("permission")}
				if has("exported") {
					c.Exported = isTrue(attr("exported"))
					c.explicitExported = true
				}
				audit.Components = append(audit.Components, c)
				compIdx = len(audit.Components) - 1
			case "intent-filter":
				if compIdx >= 0 {
					audit.Components[compIdx].IntentFilters = append(audit.Components[compIdx].IntentFilters, "")
				}
			case "action", "category":
				if n := attr("name"); n != "" && compIdx >= 0 && len(audit.Components[compIdx].IntentFilters) > 0 {
					idx := len(audit.Components[compIdx].IntentFilters) - 1
					sep := ""
					if audit.Components[compIdx].IntentFilters[idx] != "" {
						sep = ", "
					}
					audit.Components[compIdx].IntentFilters[idx] += sep + shortName(n)
				}
			}

		case xml.EndElement:
			switch t.Name.Local {
			case "activity", "activity-alias", "service", "receiver", "provider":
				compIdx = -1
			}
		}
	}

	// defaults the manifest may omit
	if !allowBackupSeen {
		audit.AllowBackup = true
	}
	if !cleartextSeen {
		if v := atoiSafe(audit.TargetSDK); v > 0 && v < 28 {
			audit.UsesCleartext = true
		}
	}
	for i := range audit.Components {
		c := &audit.Components[i]
		if !c.Exported && !c.explicitExported && len(c.IntentFilters) > 0 {
			c.ExportedImplicit = true
		}
	}
}

// parseCertGo extracts and verifies the signing certificate with apkverifier.
func parseCertGo(path string, audit *APKAudit) {
	res, err := apkverifier.Verify(path, nil)
	if err != nil {
		audit.Cert.Error = firstLine(err.Error())
	}

	if len(res.SignerCerts) > 0 && len(res.SignerCerts[0]) > 0 {
		leaf := res.SignerCerts[0][0]
		audit.Cert.Verified = err == nil
		audit.Cert.Subject = leaf.Subject.String()
		audit.Cert.Issuer = leaf.Issuer.String()
		audit.Cert.Serial = leaf.SerialNumber.String()
		audit.Cert.SigAlgo = leaf.SignatureAlgorithm.String()
		audit.Cert.ValidFrom = leaf.NotBefore.Format("2006-01-02")
		audit.Cert.ValidTo = leaf.NotAfter.Format("2006-01-02")
		s256 := sha256.Sum256(leaf.Raw)
		audit.Cert.SHA256 = hex.EncodeToString(s256[:])
		s1 := sha1.Sum(leaf.Raw)
		audit.Cert.SHA1 = hex.EncodeToString(s1[:])
	}

	// Only claim a signing scheme when verification actually succeeded — this
	// matches apksigner, which reports all-false for unsigned/broken APKs.
	// (apkverifier otherwise defaults SchemeId to 1 even when nothing verifies.)
	if err == nil {
		switch {
		case res.SigningSchemeId >= 3: // 3 or 3.1
			audit.Cert.V3 = true
		case res.SigningSchemeId == 2:
			audit.Cert.V2 = true
		case res.SigningSchemeId == 1:
			audit.Cert.V1 = true
		}
	}
}

// finalizeCert derives debug/weak/expired flags from whichever path populated
// the cert fields, so both reference and fallback paths behave the same.
func finalizeCert(audit *APKAudit) {
	subjIssuer := audit.Cert.Subject + " " + audit.Cert.Issuer
	if strings.Contains(strings.ToLower(subjIssuer), "android debug") ||
		strings.Contains(subjIssuer, "CN=Android Debug") {
		audit.Cert.IsDebug = true
	}
	algoUp := strings.ToUpper(audit.Cert.SigAlgo)
	if strings.Contains(algoUp, "MD5") || strings.Contains(algoUp, "SHA1") || strings.Contains(algoUp, "SHA-1") {
		audit.Cert.WeakAlgo = true
	}
	if audit.Cert.ValidTo != "" {
		if t, ok := parseCertTime(audit.Cert.ValidTo); ok && t.Before(time.Now()) {
			audit.Cert.Expired = true
		}
	}
}
