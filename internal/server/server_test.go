package server

import (
	"testing"

	"github.com/Bealvio/chihiro/internal/auth"
	"github.com/Bealvio/chihiro/internal/watcher"
	"github.com/spf13/viper"
)

// TestReadOnlyClusterBlocksMutation verifies that a cluster with ReadOnly=true
// is rejected by canUserModifyCluster regardless of the user's group membership.
func TestReadOnlyClusterBlocksMutation(t *testing.T) {
	viper.Set("cluster.admin_groups", []string{"platform-admins"})
	viper.Set("cluster.creator_groups", []string{"developers"})
	t.Cleanup(func() {
		viper.Set("cluster.admin_groups", nil)
		viper.Set("cluster.creator_groups", nil)
	})

	s := &Server{}

	admin := &auth.UserInfo{
		Sub:      "admin-user",
		Username: "admin",
		Groups:   []string{"platform-admins"},
		IsAdmin:  true,
	}

	dev := &auth.UserInfo{
		Sub:      "dev-user",
		Username: "dev",
		Groups:   []string{"developers"},
		IsAdmin:  false,
	}

	mutating := &watcher.ClusterInfo{
		Name:      "my-cluster",
		Namespace: "default",
		ReadOnly:  false,
		Creator:   "dev",
		Groups:    []string{"developers"},
	}

	frozen := &watcher.ClusterInfo{
		Name:      "frozen-cluster",
		Namespace: "default",
		ReadOnly:  true,
		Creator:   "dev",
		Groups:    []string{"developers"},
	}

	// Non-admin can modify a non-read-only cluster
	if !s.canUserModifyCluster(dev, mutating) {
		t.Fatal("expected dev to be able to modify a non-read-only cluster")
	}

	// Admin can modify a non-read-only cluster
	if !s.canUserModifyCluster(admin, mutating) {
		t.Fatal("expected admin to be able to modify a non-read-only cluster")
	}

	// Nobody can modify a read-only cluster — not even the creator
	if s.canUserModifyCluster(dev, frozen) {
		t.Fatal("expected dev to be blocked from modifying a read-only cluster")
	}

	// Not even an admin can modify a read-only cluster
	if s.canUserModifyCluster(admin, frozen) {
		t.Fatal("expected admin to be blocked from modifying a read-only cluster")
	}

	// Devmode does not override the read-only guard (devmode only affects
	// CheckUserGroups, which runs after the ReadOnly check).
	auth.SetDevMode(true)
	t.Cleanup(func() { auth.SetDevMode(false) })

	if s.canUserModifyCluster(dev, frozen) {
		t.Fatal("expected read-only to block mutation even in devmode")
	}
}
