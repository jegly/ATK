package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/scrypt"
)

// App-lock: an optional password gate for ATK.
//
// Threat model (be honest about it — the Settings UI says the same): the launch
// gate and the "require password for destructive actions" window are enforced
// here in Go, so the ATK app itself cannot be driven into flashing/uninstalling
// without the password. They do NOT stop a fully-compromised computer from
// invoking `adb`/`fastboot` directly, outside ATK — nothing running as the same
// user can. This raises the bar against casual misuse and stops ATK being a
// turnkey attack surface; it is not a substitute for full-disk encryption or a
// locked bootloader.
//
// The password is never stored — only a per-install random salt + scrypt hash.

// dangerWindow is how long a successful UnlockDanger keeps destructive actions
// unlocked. Kept short so an unattended session re-locks quickly.
const dangerWindow = 5 * time.Minute

type appLockConfig struct {
	Enabled          bool   `json:"enabled"`
	Salt             string `json:"salt"` // hex
	Hash             string `json:"hash"` // hex, scrypt(password, salt)
	RequireForDanger bool   `json:"requireForDanger"`
}

func appLockPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "ATK", "applock.json"), nil
}

func loadAppLock() appLockConfig {
	var c appLockConfig
	p, err := appLockPath()
	if err != nil {
		return c
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return c
	}
	_ = json.Unmarshal(data, &c)
	return c
}

func saveAppLock(c appLockConfig) error {
	p, err := appLockPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

// scryptHash derives a 32-byte key. N=32768,r=8,p=1 is the interactive-login
// preset — a few tens of ms per attempt, which is the point.
func scryptHash(password string, salt []byte) (string, error) {
	dk, err := scrypt.Key([]byte(password), salt, 1<<15, 8, 1, 32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(dk), nil
}

func (c appLockConfig) verify(password string) (bool, error) {
	if !c.Enabled || c.Hash == "" {
		return true, nil // no lock configured → everything passes
	}
	salt, err := hex.DecodeString(c.Salt)
	if err != nil {
		return false, fmt.Errorf("app-lock config is corrupt")
	}
	got, err := scryptHash(password, salt)
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(c.Hash)) == 1, nil
}

// AppLockStatus reports whether the lock is enabled and whether destructive
// actions additionally require re-entering the password. Safe to call anytime.
func (a *App) AppLockStatus() map[string]bool {
	c := loadAppLock()
	return map[string]bool{
		"enabled":          c.Enabled && c.Hash != "",
		"requireForDanger": c.RequireForDanger,
	}
}

// VerifyAppPassword is used by the launch gate. Returns true on a correct
// password (or when no lock is set).
func (a *App) VerifyAppPassword(password string) (bool, error) {
	return loadAppLock().verify(password)
}

// SetAppPassword sets or changes the launch password and enables the lock. When
// a password already exists, `current` must match it. Pass "" for `current` on
// first setup.
func (a *App) SetAppPassword(current, next string) error {
	if len(next) < 4 {
		return fmt.Errorf("password must be at least 4 characters")
	}
	c := loadAppLock()
	if c.Enabled && c.Hash != "" {
		ok, err := c.verify(current)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("current password is incorrect")
		}
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	hash, err := scryptHash(next, salt)
	if err != nil {
		return err
	}
	c.Enabled = true
	c.Salt = hex.EncodeToString(salt)
	c.Hash = hash
	return saveAppLock(c)
}

// DisableAppLock removes the lock entirely. The current password must match.
func (a *App) DisableAppLock(current string) error {
	c := loadAppLock()
	if !c.Enabled || c.Hash == "" {
		return nil
	}
	ok, err := c.verify(current)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("password is incorrect")
	}
	return saveAppLock(appLockConfig{}) // wipe salt+hash
}

// SetRequireForDanger toggles the per-action re-auth requirement. Requires the
// current password so a passer-by at an unlocked session can't switch it off.
func (a *App) SetRequireForDanger(current string, require bool) error {
	c := loadAppLock()
	if !c.Enabled || c.Hash == "" {
		return fmt.Errorf("set an app password first")
	}
	ok, err := c.verify(current)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("password is incorrect")
	}
	c.RequireForDanger = require
	return saveAppLock(c)
}

// UnlockDanger opens the destructive-action window for dangerWindow on a correct
// password. Returns true if unlocked. Called by the frontend re-auth modal.
func (a *App) UnlockDanger(password string) (bool, error) {
	c := loadAppLock()
	ok, err := c.verify(password)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}
	a.dangerMu.Lock()
	a.dangerUntil = time.Now().Add(dangerWindow)
	a.dangerMu.Unlock()
	return true, nil
}

// requireDangerUnlocked is the backend gate every destructive method calls
// first. It is a no-op unless the lock is enabled AND RequireForDanger is set.
// When armed, it fails closed until UnlockDanger has been called recently.
func (a *App) requireDangerUnlocked() error {
	c := loadAppLock()
	if !c.Enabled || c.Hash == "" || !c.RequireForDanger {
		return nil
	}
	a.dangerMu.Lock()
	until := a.dangerUntil
	a.dangerMu.Unlock()
	if time.Now().Before(until) {
		return nil
	}
	// Sentinel prefix the frontend recognises to pop the re-auth modal.
	return fmt.Errorf("DANGER_LOCKED: app password required for this action")
}
