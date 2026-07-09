package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

// Linux tray, implemented as a minimal StatusNotifierItem (+ dbusmenu) server
// directly over D-Bus. Ported from a working reference on this same machine:
// Frequency's gui.py `_Tray` class (/opt/frequency/gui.py). GTK/Wails have no
// portable tray API, and the common Go systray wrappers pull in libappindicator
// or ship raw icon pixmap bytes - the latter is exactly what breaks GNOME's
// AppIndicator extension (crashes with "can't access property 'clone'",
// documented in Cascade's README). Using an IconName resolved via our own
// IconThemePath (not the user's ~/.local/share/icons - nothing to cache-
// invalidate) sidesteps that entirely, same as both reference apps do it.

//go:embed assets/atk-tray-symbolic.svg
var trayIconSVG []byte

const (
	trayIconName = "atk-tray-symbolic"
	sniPath      = dbus.ObjectPath("/StatusNotifierItem")
	menuPath     = dbus.ObjectPath("/MenuBar")
)

var (
	trayMu    sync.Mutex
	trayState *linuxTray
)

type linuxTray struct {
	app     *App
	conn    *dbus.Conn
	iconDir string
	ok      bool
}

func initTray(a *App) {
	trayMu.Lock()
	defer trayMu.Unlock()
	if trayState != nil {
		return
	}
	t := &linuxTray{app: a}
	if err := t.start(); err != nil {
		// Non-fatal: no session bus, no StatusNotifierWatcher (extension not
		// installed/enabled), etc. ATK just runs without a tray icon.
		t.ok = false
	}
	trayState = t
}

func closeTray() {
	trayMu.Lock()
	defer trayMu.Unlock()
	if trayState == nil || trayState.conn == nil {
		return
	}
	_ = trayState.conn.Close()
	trayState = nil
}

func trayAvailable() bool {
	trayMu.Lock()
	defer trayMu.Unlock()
	return trayState != nil && trayState.ok
}

func (t *linuxTray) start() error {
	if err := t.writeIcon(); err != nil {
		return err
	}

	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return err
	}
	t.conn = conn

	if err := t.exportSNI(); err != nil {
		return err
	}
	if err := t.exportMenu(); err != nil {
		return err
	}

	name := fmt.Sprintf("org.kde.StatusNotifierItem-%d-1", os.Getpid())
	reply, err := conn.RequestName(name, dbus.NameFlagDoNotQueue)
	if err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
		return fmt.Errorf("could not own tray bus name")
	}

	watcher := conn.Object("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher")
	call := watcher.Call("org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem", 0, name)
	if call.Err != nil {
		// No watcher running (AppIndicator extension off, or a DE without one).
		return call.Err
	}
	t.ok = true
	return nil
}

// writeIcon materialises the embedded SVG to an app-owned directory and
// advertises that directory via IconThemePath, rather than installing into
// the user's shared ~/.local/share/icons (no icon-cache/gtk-update step
// needed - the same approach Frequency uses via its bundled icons/ dir).
func (t *linuxTray) writeIcon() error {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		cacheDir = os.TempDir()
	}
	dir := filepath.Join(cacheDir, "atk", "tray-icons")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, trayIconName+".svg")
	if err := os.WriteFile(path, trayIconSVG, 0o644); err != nil {
		return err
	}
	t.iconDir = dir
	return nil
}

// --- org.kde.StatusNotifierItem -------------------------------------------

const sniIntrospectXML = `
<interface name="org.kde.StatusNotifierItem">
  <property name="Category" type="s" access="read"/>
  <property name="Id" type="s" access="read"/>
  <property name="Title" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="IconThemePath" type="s" access="read"/>
  <property name="Menu" type="o" access="read"/>
  <property name="ItemIsMenu" type="b" access="read"/>
  <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
</interface>`

type sniHandler struct{ t *linuxTray }

func (h *sniHandler) Activate(x, y int32) *dbus.Error {
	h.t.app.ToggleWindow()
	return nil
}
func (h *sniHandler) SecondaryActivate(x, y int32) *dbus.Error {
	h.t.app.ToggleWindow()
	return nil
}
func (h *sniHandler) ContextMenu(x, y int32) *dbus.Error { return nil }
func (h *sniHandler) Scroll(delta int32, orientation string) *dbus.Error { return nil }

func (h *sniHandler) sniProps() map[string]dbus.Variant {
	return map[string]dbus.Variant{
		"Category":      dbus.MakeVariant("ApplicationStatus"),
		"Id":             dbus.MakeVariant("atk"),
		"Title":          dbus.MakeVariant("ATK"),
		"Status":         dbus.MakeVariant("Active"),
		"IconName":       dbus.MakeVariant(trayIconName),
		"IconThemePath":  dbus.MakeVariant(h.t.iconDir),
		"Menu":           dbus.MakeVariant(menuPath),
		"ItemIsMenu":     dbus.MakeVariant(false),
	}
}

func (h *sniHandler) Get(iface, propName string) (dbus.Variant, *dbus.Error) {
	v, ok := h.sniProps()[propName]
	if !ok {
		return dbus.Variant{}, dbus.NewError("org.freedesktop.DBus.Error.UnknownProperty", nil)
	}
	return v, nil
}
func (h *sniHandler) GetAll(iface string) (map[string]dbus.Variant, *dbus.Error) {
	return h.sniProps(), nil
}
func (h *sniHandler) Set(iface, propName string, value dbus.Variant) *dbus.Error {
	return dbus.NewError("org.freedesktop.DBus.Error.PropertyReadOnly", nil)
}

func (t *linuxTray) exportSNI() error {
	h := &sniHandler{t: t}
	if err := t.conn.Export(h, sniPath, "org.kde.StatusNotifierItem"); err != nil {
		return err
	}
	if err := t.conn.Export(h, sniPath, "org.freedesktop.DBus.Properties"); err != nil {
		return err
	}
	node := `<node>` + sniIntrospectXML + `</node>`
	return t.conn.Export(introspect.Introspectable(node), sniPath, "org.freedesktop.DBus.Introspectable")
}

// --- com.canonical.dbusmenu -------------------------------------------

const menuIntrospectXML = `
<interface name="com.canonical.dbusmenu">
  <property name="Version" type="u" access="read"/>
  <property name="Status" type="s" access="read"/>
  <method name="GetLayout">
    <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
    <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
  </method>
  <method name="GetGroupProperties">
    <arg type="ai" direction="in"/><arg type="as" direction="in"/>
    <arg type="a(ia{sv})" direction="out"/>
  </method>
  <method name="Event">
    <arg type="i" direction="in"/><arg type="s" direction="in"/>
    <arg type="v" direction="in"/><arg type="u" direction="in"/>
  </method>
  <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
</interface>`

// menuNode mirrors dbusmenu's recursive (ia{sv}av) layout struct: id,
// properties, children (each child a variant wrapping another menuNode).
type menuNode struct {
	ID       int32
	Props    map[string]dbus.Variant
	Children []dbus.Variant
}

type groupProps struct {
	ID    int32
	Props map[string]dbus.Variant
}

// menuItem ids: 0 is reserved for the menu root (GetLayout's implicit parent),
// so item/separator ids start at 1 and must all stay distinct from it and
// from each other.
type menuItemDef struct {
	id    int32
	label string // empty => separator
}

func menuItems() []menuItemDef {
	return []menuItemDef{
		{1, "Show / Hide ATK"},
		{2, ""}, // separator
		{3, "Quit ATK"},
	}
}

func menuItemProps(item menuItemDef) map[string]dbus.Variant {
	if item.label == "" {
		return map[string]dbus.Variant{"type": dbus.MakeVariant("separator")}
	}
	return map[string]dbus.Variant{
		"label":   dbus.MakeVariant(item.label),
		"enabled": dbus.MakeVariant(true),
	}
}

type menuHandler struct{ t *linuxTray }

func (h *menuHandler) GetLayout(parentID, recursionDepth int32, propertyNames []string) (uint32, menuNode, *dbus.Error) {
	var children []dbus.Variant
	for _, item := range menuItems() {
		children = append(children, dbus.MakeVariant(menuNode{
			ID:       item.id,
			Props:    menuItemProps(item),
			Children: nil,
		}))
	}
	root := menuNode{
		ID:       0,
		Props:    map[string]dbus.Variant{"children-display": dbus.MakeVariant("submenu")},
		Children: children,
	}
	return 1, root, nil
}

func (h *menuHandler) GetGroupProperties(ids []int32, propertyNames []string) ([]groupProps, *dbus.Error) {
	wanted := make(map[int32]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	var out []groupProps
	for _, item := range menuItems() {
		if wanted[item.id] {
			out = append(out, groupProps{ID: item.id, Props: menuItemProps(item)})
		}
	}
	return out, nil
}

func (h *menuHandler) Event(id int32, eventID string, data dbus.Variant, timestamp uint32) *dbus.Error {
	if eventID != "clicked" {
		return nil
	}
	switch id {
	case 1:
		h.t.app.ToggleWindow()
	case 3:
		h.t.app.QuitApp()
	}
	return nil
}

func (h *menuHandler) AboutToShow(id int32) (bool, *dbus.Error) { return false, nil }

func (h *menuHandler) menuProps() map[string]dbus.Variant {
	return map[string]dbus.Variant{
		"Version": dbus.MakeVariant(uint32(3)),
		"Status":  dbus.MakeVariant("normal"),
	}
}
func (h *menuHandler) Get(iface, propName string) (dbus.Variant, *dbus.Error) {
	v, ok := h.menuProps()[propName]
	if !ok {
		return dbus.Variant{}, dbus.NewError("org.freedesktop.DBus.Error.UnknownProperty", nil)
	}
	return v, nil
}
func (h *menuHandler) GetAll(iface string) (map[string]dbus.Variant, *dbus.Error) {
	return h.menuProps(), nil
}
func (h *menuHandler) Set(iface, propName string, value dbus.Variant) *dbus.Error {
	return dbus.NewError("org.freedesktop.DBus.Error.PropertyReadOnly", nil)
}

func (t *linuxTray) exportMenu() error {
	h := &menuHandler{t: t}
	if err := t.conn.Export(h, menuPath, "com.canonical.dbusmenu"); err != nil {
		return err
	}
	if err := t.conn.Export(h, menuPath, "org.freedesktop.DBus.Properties"); err != nil {
		return err
	}
	node := `<node>` + menuIntrospectXML + `</node>`
	return t.conn.Export(introspect.Introspectable(node), menuPath, "org.freedesktop.DBus.Introspectable")
}
