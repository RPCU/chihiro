package mcp

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/Bealvio/chihiro/internal/auth"
	"github.com/spf13/viper"
)

// MCPUser represents an authenticated MCP client.
type MCPUser struct {
	Username string
	Groups   []string
}

// Authenticate extracts and validates credentials from an HTTP request.
// In devmode, returns a fixed admin user without checking any key.
// In production, validates the Authorization: Bearer <key> header against
// the configured mcp.api_key value.
func Authenticate(r *http.Request) (*MCPUser, bool) {
	if auth.DevModeEnabled() {
		slog.Debug("MCP devmode: using default admin user")
		return &MCPUser{
			Username: "mcp-devmode",
			Groups:   viper.GetStringSlice("cluster.admin_groups"),
		}, true
	}

	apiKey := viper.GetString("mcp.api_key")
	if apiKey == "" {
		return nil, false
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		slog.Warn("MCP authentication rejected: missing Authorization header")
		return nil, false
	}

	token, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok {
		slog.Warn("MCP authentication rejected: malformed Authorization header")
		return nil, false
	}

	if token != apiKey {
		slog.Warn("MCP authentication rejected: invalid API key")
		return nil, false
	}

	slog.Debug("MCP request authenticated via API key")

	adminGroups := viper.GetStringSlice("cluster.admin_groups")
	return &MCPUser{
		Username: "mcp-user",
		Groups:   adminGroups,
	}, true
}
