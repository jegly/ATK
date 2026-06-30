package main

import (
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"os"
)

// Boot-image analysis + file hashing — both work entirely on local files, no
// device required.

type BootInfo struct {
	Valid          bool   `json:"valid"`
	Type           string `json:"type"`
	HeaderVersion  int    `json:"headerVersion"`
	AndroidVersion string `json:"androidVersion"`
	SecurityPatch  string `json:"securityPatch"`
	PageSize       int    `json:"pageSize"`
	KernelKB       int    `json:"kernelKB"`
	RamdiskKB      int    `json:"ramdiskKB"`
	SizeMB         int    `json:"sizeMB"`
	SHA1           string `json:"sha1"`
	SHA256         string `json:"sha256"`
	Root           string `json:"root"`
}

// AnalyzeBootImage parses an Android boot / init_boot / vendor_boot image:
// header version, OS version + security patch, sizes, hashes, and a best-effort
// scan for root-solution markers (Magisk / KernelSU / APatch).
func (a *App) AnalyzeBootImage(path string) (BootInfo, error) {
	var bi BootInfo
	st, err := os.Stat(path)
	if err != nil {
		return bi, err
	}
	if st.Size() > 256<<20 {
		return bi, fmt.Errorf("file too large to be a boot image (%d MB)", st.Size()>>20)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return bi, err
	}
	if len(data) < 64 {
		return bi, fmt.Errorf("file too small to be a boot image")
	}

	bi.SizeMB = len(data) / (1024 * 1024)
	s1 := sha1.Sum(data)
	bi.SHA1 = hex.EncodeToString(s1[:])
	s2 := sha256.Sum256(data)
	bi.SHA256 = hex.EncodeToString(s2[:])

	switch string(data[0:8]) {
	case "ANDROID!":
		bi.Type = "boot / init_boot"
		bi.Valid = true
	case "VNDRBOOT":
		bi.Type = "vendor_boot"
		bi.Valid = true
	default:
		bi.Type = "not a boot image"
	}

	if bi.Valid && bi.Type != "vendor_boot" {
		hv := binary.LittleEndian.Uint32(data[40:44])
		bi.HeaderVersion = int(hv)

		osverOff := 44
		if hv >= 3 {
			osverOff = 16
		}
		if osverOff+4 <= len(data) {
			osver := binary.LittleEndian.Uint32(data[osverOff : osverOff+4])
			if osver != 0 {
				ver := osver >> 11
				bi.AndroidVersion = fmt.Sprintf("%d.%d.%d", (ver>>14)&0x7f, (ver>>7)&0x7f, ver&0x7f)
				patch := osver & 0x7ff
				month := patch & 0xf
				if month >= 1 && month <= 12 {
					bi.SecurityPatch = fmt.Sprintf("%04d-%02d", 2000+((patch>>4)&0x7f), month)
				}
			}
		}

		if hv >= 3 {
			bi.KernelKB = int(binary.LittleEndian.Uint32(data[8:12])) / 1024
			bi.RamdiskKB = int(binary.LittleEndian.Uint32(data[12:16])) / 1024
			bi.PageSize = 4096
		} else {
			bi.KernelKB = int(binary.LittleEndian.Uint32(data[8:12])) / 1024
			bi.RamdiskKB = int(binary.LittleEndian.Uint32(data[16:20])) / 1024
			bi.PageSize = int(binary.LittleEndian.Uint32(data[36:40]))
		}
	}

	switch {
	case bytes.Contains(data, []byte("KernelSU")) || bytes.Contains(data, []byte("ksud")):
		bi.Root = "KernelSU markers found"
	case bytes.Contains(data, []byte("APatch")) || bytes.Contains(data, []byte("apatch")):
		bi.Root = "APatch markers found"
	case bytes.Contains(data, []byte("MAGISK")) || bytes.Contains(data, []byte("magisk")):
		bi.Root = "Magisk markers found"
	default:
		bi.Root = "none (appears stock)"
	}
	return bi, nil
}

type FileHashes struct {
	SHA256    string `json:"sha256"`
	SHA1      string `json:"sha1"`
	SizeBytes int64  `json:"sizeBytes"`
}

// HashFile streams a file and returns its SHA-256 / SHA-1 (works for any size).
func (a *App) HashFile(path string) (FileHashes, error) {
	f, err := os.Open(path)
	if err != nil {
		return FileHashes{}, err
	}
	defer f.Close()
	st, _ := f.Stat()
	h1, h2 := sha1.New(), sha256.New()
	if _, err := io.Copy(io.MultiWriter(h1, h2), f); err != nil {
		return FileHashes{}, err
	}
	return FileHashes{
		SHA256:    hex.EncodeToString(h2.Sum(nil)),
		SHA1:      hex.EncodeToString(h1.Sum(nil)),
		SizeBytes: st.Size(),
	}, nil
}
