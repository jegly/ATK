package main

import (
	"archive/zip"
	"bytes"
	"compress/bzip2"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ulikunitz/xz"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// payload.bin extraction — pull individual partition images out of an A/B OTA
// zip. Supports FULL OTAs (REPLACE / REPLACE_XZ / REPLACE_BZ / ZERO ops);
// incremental/delta OTAs need the source partitions and are not supported.
//
// payload.bin format: header "CrAU" + version + manifest_size [+ metadata sig
// size for v2], a protobuf DeltaArchiveManifest, then the data blobs. We parse
// just the manifest fields we need by hand to avoid pulling in protoc.

const payloadMagic = "CrAU"

type PayloadPartition struct {
	Name   string `json:"name"`
	SizeMB int    `json:"sizeMB"`
}

type plExtent struct{ start, num uint64 }
type plOp struct {
	typ, dataOffset, dataLength uint64
	dst                         []plExtent
}
type plPart struct {
	name string
	ops  []plOp
}

// pbFields walks protobuf wire-format fields, invoking cb(field, wire, data, varint).
func pbFields(b []byte, cb func(field, wire int, data []byte, v uint64) bool) {
	i := 0
	for i < len(b) {
		tag, n := binary.Uvarint(b[i:])
		if n <= 0 {
			return
		}
		i += n
		field, wire := int(tag>>3), int(tag&7)
		switch wire {
		case 0:
			v, n := binary.Uvarint(b[i:])
			if n <= 0 {
				return
			}
			i += n
			if !cb(field, wire, nil, v) {
				return
			}
		case 2:
			l, n := binary.Uvarint(b[i:])
			if n <= 0 {
				return
			}
			i += n
			if i+int(l) > len(b) {
				return
			}
			if !cb(field, wire, b[i:i+int(l)], 0) {
				return
			}
			i += int(l)
		case 5:
			i += 4
		case 1:
			i += 8
		default:
			return
		}
	}
}

func plParseExtent(b []byte) plExtent {
	var e plExtent
	pbFields(b, func(f, w int, d []byte, v uint64) bool {
		switch f {
		case 1:
			e.start = v
		case 2:
			e.num = v
		}
		return true
	})
	return e
}

func plParseOp(b []byte) plOp {
	var o plOp
	pbFields(b, func(f, w int, d []byte, v uint64) bool {
		switch f {
		case 1:
			o.typ = v
		case 2:
			o.dataOffset = v
		case 3:
			o.dataLength = v
		case 6:
			o.dst = append(o.dst, plParseExtent(d))
		}
		return true
	})
	return o
}

func plParsePartition(b []byte) plPart {
	var p plPart
	pbFields(b, func(f, w int, d []byte, v uint64) bool {
		switch f {
		case 1:
			p.name = string(d)
		case 8:
			p.ops = append(p.ops, plParseOp(d))
		}
		return true
	})
	return p
}

// openPayload locates payload.bin inside the OTA zip and returns a seekable
// reader over it, the offset where blob data starts, the parsed manifest parts,
// the block size, and a closer.
func (a *App) openPayload(zipPath string) (*io.SectionReader, int64, []plPart, uint64, func(), error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, 0, nil, 0, nil, fmt.Errorf("cannot open zip: %w", err)
	}
	var pf *zip.File
	for _, f := range zr.File {
		name := f.Name
		if i := strings.LastIndex(name, "/"); i >= 0 {
			name = name[i+1:]
		}
		if name == "payload.bin" {
			pf = f
			break
		}
	}
	if pf == nil {
		zr.Close()
		return nil, 0, nil, 0, nil, fmt.Errorf("no payload.bin in zip — is this an A/B OTA?")
	}
	if pf.Method != zip.Store {
		zr.Close()
		return nil, 0, nil, 0, nil, fmt.Errorf("payload.bin is compressed inside the zip (unsupported)")
	}
	off, err := pf.DataOffset()
	if err != nil {
		zr.Close()
		return nil, 0, nil, 0, nil, err
	}
	fh, err := os.Open(zipPath)
	if err != nil {
		zr.Close()
		return nil, 0, nil, 0, nil, err
	}
	closer := func() { fh.Close(); zr.Close() }

	sr := io.NewSectionReader(fh, off, int64(pf.UncompressedSize64))
	hdr := make([]byte, 20)
	if _, err := io.ReadFull(sr, hdr); err != nil {
		closer()
		return nil, 0, nil, 0, nil, err
	}
	if string(hdr[0:4]) != payloadMagic {
		closer()
		return nil, 0, nil, 0, nil, fmt.Errorf("bad payload magic — not a valid payload.bin")
	}
	version := binary.BigEndian.Uint64(hdr[4:12])
	manifestSize := binary.BigEndian.Uint64(hdr[12:20])
	headerSize := int64(20)
	var metaSig uint32
	if version >= 2 {
		var b4 [4]byte
		if _, err := io.ReadFull(sr, b4[:]); err != nil {
			closer()
			return nil, 0, nil, 0, nil, err
		}
		metaSig = binary.BigEndian.Uint32(b4[:])
		headerSize = 24
	}
	manifest := make([]byte, manifestSize)
	if _, err := io.ReadFull(sr, manifest); err != nil {
		closer()
		return nil, 0, nil, 0, nil, err
	}
	dataBase := headerSize + int64(manifestSize) + int64(metaSig)

	blockSize := uint64(4096)
	var parts []plPart
	pbFields(manifest, func(f, w int, d []byte, v uint64) bool {
		switch f {
		case 3:
			if v > 0 {
				blockSize = v
			}
		case 13:
			parts = append(parts, plParsePartition(d))
		}
		return true
	})
	return sr, dataBase, parts, blockSize, closer, nil
}

// ListPayloadPartitions returns the partitions inside an OTA's payload.bin.
func (a *App) ListPayloadPartitions(zipPath string) ([]PayloadPartition, error) {
	_, _, parts, blockSize, closer, err := a.openPayload(zipPath)
	if err != nil {
		return nil, err
	}
	closer()
	if len(parts) == 0 {
		return nil, fmt.Errorf("no partitions found in payload")
	}
	out := make([]PayloadPartition, 0, len(parts))
	for _, p := range parts {
		var blocks uint64
		for _, o := range p.ops {
			for _, e := range o.dst {
				blocks += e.num
			}
		}
		out = append(out, PayloadPartition{Name: p.name, SizeMB: int(blocks * blockSize / (1024 * 1024))})
	}
	return out, nil
}

// ExtractPayloadPartition extracts one partition image to a chosen path.
func (a *App) ExtractPayloadPartition(zipPath, partName string) (string, error) {
	sr, dataBase, parts, blockSize, closer, err := a.openPayload(zipPath)
	if err != nil {
		return "", err
	}
	defer closer()

	var part *plPart
	for i := range parts {
		if parts[i].name == partName {
			part = &parts[i]
			break
		}
	}
	if part == nil {
		return "", fmt.Errorf("partition %q not in payload", partName)
	}

	var totalBlocks uint64
	for _, o := range part.ops {
		for _, e := range o.dst {
			totalBlocks += e.num
		}
	}
	total := totalBlocks * blockSize

	outPath, err := a.SelectSaveFile(partName + ".img")
	if err != nil {
		return "", err
	}
	if outPath == "" {
		return "Extraction cancelled.", nil
	}
	out, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	var written uint64
	lastPct := -1
	emit := func() {
		if total == 0 {
			return
		}
		pct := int(written * 100 / total)
		if pct != lastPct {
			lastPct = pct
			runtime.EventsEmit(a.ctx, "payload:progress", map[string]interface{}{"percent": pct})
		}
	}

	for _, o := range part.ops {
		if ctx.Err() != nil {
			runtime.EventsEmit(a.ctx, "payload:done", nil)
			return "", fmt.Errorf("cancelled")
		}
		switch o.typ {
		case 6, 7: // ZERO / DISCARD — leave as sparse holes, just count progress
			for _, e := range o.dst {
				written += e.num * blockSize
			}
			emit()
			continue
		case 0, 1, 8: // REPLACE / REPLACE_BZ / REPLACE_XZ
		default:
			runtime.EventsEmit(a.ctx, "payload:done", nil)
			return "", fmt.Errorf("this looks like an incremental OTA (op type %d) — only full OTAs are supported", o.typ)
		}

		comp := make([]byte, o.dataLength)
		if _, err := sr.Seek(dataBase+int64(o.dataOffset), io.SeekStart); err != nil {
			runtime.EventsEmit(a.ctx, "payload:done", nil)
			return "", err
		}
		if _, err := io.ReadFull(sr, comp); err != nil {
			runtime.EventsEmit(a.ctx, "payload:done", nil)
			return "", err
		}

		var raw []byte
		switch o.typ {
		case 0:
			raw = comp
		case 1:
			raw, err = io.ReadAll(bzip2.NewReader(bytes.NewReader(comp)))
		case 8:
			var zr *xz.Reader
			if zr, err = xz.NewReader(bytes.NewReader(comp)); err == nil {
				raw, err = io.ReadAll(zr)
			}
		}
		if err != nil {
			runtime.EventsEmit(a.ctx, "payload:done", nil)
			return "", fmt.Errorf("decompress failed: %w", err)
		}

		pos := 0
		for _, e := range o.dst {
			n := int(e.num * blockSize)
			if pos+n > len(raw) {
				n = len(raw) - pos
			}
			if n <= 0 {
				continue
			}
			if _, err := out.WriteAt(raw[pos:pos+n], int64(e.start*blockSize)); err != nil {
				runtime.EventsEmit(a.ctx, "payload:done", nil)
				return "", err
			}
			pos += n
			written += uint64(n)
			emit()
		}
	}

	out.Truncate(int64(total)) // ensure final size incl. trailing zero regions
	runtime.EventsEmit(a.ctx, "payload:done", nil)
	return fmt.Sprintf("Extracted %s → %s", partName, outPath), nil
}
