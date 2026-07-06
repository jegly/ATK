package main

// Intent Lab — list an app's launchable (exported) activities and start them via
// `am start`, plus a free-form implicit-intent launcher. Lets a user reach hidden
// settings menus / internal screens that aren't on the launcher.
//
// Activity discovery uses `dumpsys package <pkg>`: components that appear in the
// Activity Resolver Table have an intent filter, so they're launchable by the
// shell user. Non-filtered/exported=false activities generally can't be started
// from adb; the launcher surfaces the real `am start` result either way.

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type IntentActivity struct {
	Name      string `json:"name"`      // activity class, relative to the package
	Component string `json:"component"` // full "package/activity" target for am start
	Exported  bool   `json:"exported"`  // appears in the resolver table (has an intent filter)
}

// componentRe guards the `am start -n <component>` target against shell injection
// on the device side (adb shell reparses the command).
var componentRe = regexp.MustCompile(`^[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+$`)
var actionRe = regexp.MustCompile(`^[A-Za-z0-9_.]+$`)

// ListActivities returns the launchable activities of an installed package.
func (a *App) ListActivities(packageName string) ([]IntentActivity, error) {
	if err := validatePackageName(packageName); err != nil {
		return nil, err
	}
	dump, err := a.runAdbShellTimeout(30*1e9, "dumpsys", "package", packageName)
	if err != nil {
		return nil, fmt.Errorf("failed to query package: %w", err)
	}

	prefix := packageName + "/"
	seen := map[string]bool{}
	var acts []IntentActivity
	inActivities := false

	for _, line := range strings.Split(dump, "\n") {
		t := strings.TrimSpace(line)
		switch {
		case strings.Contains(t, "Activity Resolver Table"):
			inActivities = true
			continue
		case strings.Contains(t, "Receiver Resolver Table"),
			strings.Contains(t, "Service Resolver Table"),
			strings.Contains(t, "Provider Resolver Table"),
			strings.Contains(t, "Preferred Activities"),
			strings.Contains(t, "Key Set Manager"):
			inActivities = false
		}
		if !inActivities {
			continue
		}
		for _, tok := range strings.Fields(t) {
			if strings.HasPrefix(tok, prefix) && len(tok) > len(prefix) && !seen[tok] {
				seen[tok] = true
				acts = append(acts, IntentActivity{
					Name:      strings.TrimPrefix(tok, prefix),
					Component: tok,
					Exported:  true,
				})
			}
		}
	}

	sort.Slice(acts, func(i, j int) bool { return acts[i].Name < acts[j].Name })
	return acts, nil
}

// StartActivity launches an explicit component ("package/activity").
func (a *App) StartActivity(component string) (string, error) {
	component = strings.TrimSpace(component)
	if !componentRe.MatchString(component) {
		return "", fmt.Errorf("invalid component, expected package/activity: %s", component)
	}
	out, err := a.runAdbShell("am", "start", "-n", component)
	return interpretAmResult(out, err)
}

// StartIntentAction launches an implicit intent by action, with an optional data URI.
func (a *App) StartIntentAction(action, data string) (string, error) {
	action = strings.TrimSpace(action)
	if action == "" || !actionRe.MatchString(action) {
		return "", fmt.Errorf("invalid or empty action")
	}
	args := []string{"am", "start", "-a", action}
	if data = strings.TrimSpace(data); data != "" {
		// Reject shell metacharacters — adb shell reparses this on the device.
		if strings.ContainsAny(data, " \t\n\r;&|`$<>()\"'\\") {
			return "", fmt.Errorf("data URI contains disallowed characters")
		}
		args = append(args, "-d", data)
	}
	out, err := a.runAdbShell(args...)
	return interpretAmResult(out, err)
}

// interpretAmResult normalises `am start` output — it often prints errors to
// stdout with a zero exit, so inspect the text as well as err.
func interpretAmResult(out string, err error) (string, error) {
	out = strings.TrimSpace(out)
	if err != nil {
		if out != "" {
			return "", fmt.Errorf("%s", firstLine(out))
		}
		return "", err
	}
	if strings.Contains(out, "Error:") || strings.Contains(out, "Exception") ||
		strings.Contains(out, "does not exist") || strings.Contains(out, "Permission Denial") {
		return "", fmt.Errorf("%s", firstLine(out))
	}
	if out == "" {
		out = "Started."
	}
	return out, nil
}
