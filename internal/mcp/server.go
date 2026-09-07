package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/Bealvio/chihiro/internal/watcher"
)

// Handler exposes the MCP Streamable HTTP handler for mounting on a Gin router.
type Handler struct {
	watcher *watcher.ClusterWatcher
	manager *cluster.Manager
}

// NewHandler creates a new MCP handler with all tools registered.
func NewHandler(w *watcher.ClusterWatcher, m *cluster.Manager) *Handler {
	return &Handler{
		watcher: w,
		manager: m,
	}
}

// ServeHTTP implements http.Handler so the MCP endpoint can be mounted on Gin.
// It authenticates the request and delegates to the MCP Streamable HTTP handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, ok := Authenticate(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	slog.Debug("MCP session authenticated", "username", user.Username)

	deps := &toolDeps{
		watcher: h.watcher,
		manager: h.manager,
		user:    user,
	}

	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "chihiro",
		Version: "0.1.0",
	}, nil)

	mcp.AddTool(srv, listClustersTool(), wrapHandler(handleListClusters, deps))
	mcp.AddTool(srv, describeClusterTool(), wrapHandler(handleDescribeCluster, deps))
	mcp.AddTool(srv, getVersionsTool(), wrapHandler(handleGetVersions, deps))
	mcp.AddTool(srv, getLimitsTool(), wrapHandler(handleGetLimits, deps))
	mcp.AddTool(srv, getParametersTool(), wrapHandler(handleGetParameters, deps))
	mcp.AddTool(srv, previewClusterTool(), wrapHandler(handlePreviewCluster, deps))
	mcp.AddTool(srv, createClusterTool(), wrapHandler(handleCreateCluster, deps))
	mcp.AddTool(srv, deleteClusterTool(), wrapHandler(handleDeleteCluster, deps))
	mcp.AddTool(srv, editClusterTool(), wrapHandler(handleEditCluster, deps))

	hdl := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return srv
	}, nil)

	hdl.ServeHTTP(w, r)
}

// toolHandlerFunc is the signature for our tool handler functions.
type toolHandlerFunc func(ctx context.Context, req *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error)

// wrapHandler returns a mcp.ToolHandlerFor that delegates to the given function.
func wrapHandler(fn toolHandlerFunc, deps *toolDeps) mcp.ToolHandlerFor[map[string]any, any] {
	return func(ctx context.Context, req *mcp.CallToolRequest, input map[string]any) (*mcp.CallToolResult, any, error) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("MCP tool handler panic", "error", r)
			}
		}()
		return fn(ctx, req, input, deps)
	}
}
