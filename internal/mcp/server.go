package mcp

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/Bealvio/chihiro/internal/watcher"
)

// Handler exposes the MCP Streamable HTTP handler for mounting on a Gin router.
type Handler struct {
	handler http.Handler
}

// NewHandler creates a new MCP handler with all tools registered.
// Authentication happens per-request inside the getClient callback.
func NewHandler(w *watcher.ClusterWatcher, m *cluster.Manager, version string) *Handler {
	h := &Handler{}

	h.handler = mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		user, ok := Authenticate(r)
		if !ok {
			return nil
		}

		slog.Debug("MCP session authenticated", "username", user.Username)

		deps := &toolDeps{
			watcher: w,
			manager: m,
			user:    user,
		}

		srv := mcp.NewServer(&mcp.Implementation{
			Name:    "chihiro",
			Version: version,
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

		return srv
	}, nil)

	return h
}

// ServeHTTP implements http.Handler so the MCP endpoint can be mounted on Gin.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
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
