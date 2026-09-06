package auth

import "testing"

// TestDevModeDefaultsOff guards the most dangerous property of the devmode
// permission bypass: it must be inert unless an operator explicitly enables it.
func TestDevModeDefaultsOff(t *testing.T) {
	if DevModeEnabled() {
		t.Fatal("devmode must default to disabled")
	}

	if CheckUserGroups([]string{"developers"}, []string{"platform-admins"}) {
		t.Fatal("CheckUserGroups must deny a user outside the required groups when devmode is off")
	}
}

func TestCheckUserGroupsBypassedInDevMode(t *testing.T) {
	SetDevMode(true)
	t.Cleanup(func() { SetDevMode(false) })

	if !DevModeEnabled() {
		t.Fatal("SetDevMode(true) did not enable devmode")
	}

	if !CheckUserGroups(nil, []string{"platform-admins"}) {
		t.Error("devmode must grant access to a user with no groups at all")
	}

	if !CheckUserGroups([]string{"unrelated"}, []string{"platform-admins", "cluster-admin"}) {
		t.Error("devmode must grant access regardless of the configured required groups")
	}
}

func TestNewDevModeMiddlewareEnablesBypass(t *testing.T) {
	t.Cleanup(func() { SetDevMode(false) })

	m := NewDevModeMiddleware()
	if !m.devmode {
		t.Error("NewDevModeMiddleware must mark the middleware as devmode")
	}
	if !DevModeEnabled() {
		t.Error("NewDevModeMiddleware must enable the global permission bypass")
	}
}

// TestNewMiddlewareDoesNotEnableBypass ensures the production constructor never
// flips the global bypass on.
func TestNewMiddlewareDoesNotEnableBypass(t *testing.T) {
	t.Cleanup(func() { SetDevMode(false) })

	NewMiddleware(nil)
	if DevModeEnabled() {
		t.Error("NewMiddleware must never enable the devmode permission bypass")
	}
}
