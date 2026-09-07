package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/viper"

	"github.com/Bealvio/chihiro/internal/auth"
	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/Bealvio/chihiro/internal/watcher"
)

var clusterNameRegex = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)

// toolDeps holds the shared dependencies injected into every tool handler.
type toolDeps struct {
	watcher *watcher.ClusterWatcher
	manager *cluster.Manager
	user    *MCPUser
}

func (d *toolDeps) isAdmin() bool {
	adminGroups := viper.GetStringSlice("cluster.admin_groups")
	return auth.CheckUserGroups(d.user.Groups, adminGroups)
}

func (d *toolDeps) canModify(target *watcher.ClusterInfo) bool {
	if target.ReadOnly {
		return false
	}
	if d.isAdmin() {
		return true
	}
	creatorGroups := viper.GetStringSlice("cluster.creator_groups")
	if len(creatorGroups) == 0 {
		creatorGroups = viper.GetStringSlice("cluster.admin_groups")
	}
	if !auth.CheckUserGroups(d.user.Groups, creatorGroups) {
		return false
	}
	if target.Creator == d.user.Username {
		return true
	}
	for _, ug := range d.user.Groups {
		for _, cg := range target.Groups {
			if ug == cg {
				return true
			}
		}
	}
	return false
}

func (d *toolDeps) findCluster(name string) (*watcher.ClusterInfo, bool) {
	for _, c := range d.watcher.GetClustersForUser(d.user.Groups) {
		if c.Name == name {
			return c, true
		}
	}
	return nil, false
}

// --- Tool definitions ---

func listClustersTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "list_clusters",
		Description: "List all Kubernetes clusters visible to the authenticated user. Returns cluster name, phase, version, node count, and readiness status.",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func describeClusterTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "describe_cluster",
		Description: "Get detailed information about a specific cluster by name, including its full status, network config, labels, annotations, and worker groups.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string", "description": "The cluster name"},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
	}
}

func getVersionsTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_versions",
		Description: "List available Kubernetes versions that can be used for new clusters or upgrades.",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func getLimitsTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_limits",
		Description: "Get current fleet-wide resource limits (max clusters, max total nodes, max total control plane replicas) and current usage.",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func getParametersTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_parameters",
		Description: "Discover template parameters available for cluster creation. Returns each parameter's key, label, type, default value, options, and constraints. Use this to understand what fields can be set when creating a cluster.",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
	}
}

func previewClusterTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "preview_cluster",
		Description: "Preview the rendered Kubernetes YAML for a cluster without creating it. Use this to verify the manifest before creating.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":    map[string]any{"type": "string", "description": "Cluster name (lowercase alphanumeric with hyphens)"},
				"version": map[string]any{"type": "string", "description": "Kubernetes version (e.g. v1.31.2)"},
				"nodes":   map[string]any{"type": "integer", "description": "Number of worker nodes", "minimum": 0},
				"controlPlaneReplicas": map[string]any{
					"type":        "integer",
					"description": "Number of control plane replicas (odd numbers recommended)",
					"minimum":     1,
				},
				"groups": map[string]any{"type": "string", "description": "Comma-separated list of access groups"},
				"parameters": map[string]any{
					"type":                 "object",
					"description":          "Dynamic template parameters (key-value pairs from get_parameters)",
					"additionalProperties": map[string]any{"type": "string"},
				},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
	}
}

func createClusterTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "create_cluster",
		Description: "Create a new Kubernetes cluster via Cluster API. Use get_parameters first to discover available parameters, and preview_cluster to verify the YAML before creating.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":    map[string]any{"type": "string", "description": "Cluster name (lowercase alphanumeric with hyphens)"},
				"version": map[string]any{"type": "string", "description": "Kubernetes version (e.g. v1.31.2). Use get_versions to list options."},
				"nodes":   map[string]any{"type": "integer", "description": "Number of worker nodes", "minimum": 0},
				"controlPlaneReplicas": map[string]any{
					"type":        "integer",
					"description": "Number of control plane replicas (odd numbers recommended)",
					"minimum":     1,
				},
				"groups": map[string]any{
					"type":        "string",
					"description": "Comma-separated list of access groups that can view/manage this cluster",
				},
				"parameters": map[string]any{
					"type":                 "object",
					"description":          "Dynamic template parameters (key-value pairs from get_parameters)",
					"additionalProperties": map[string]any{"type": "string"},
				},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
	}
}

func deleteClusterTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "delete_cluster",
		Description: "Delete a cluster by name. This is irreversible. The cluster must not be read-only and you must have modify permissions.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string", "description": "The cluster name to delete"},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
	}
}

func editClusterTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "edit_cluster",
		Description: "Edit a cluster field. Supported fields: 'version' (Kubernetes version), 'nodes' (worker count), 'controlPlaneReplicas' (CP replicas), 'groups' (access groups), 'workerGroups' (JSON array of worker group objects), and any editable parameter key from get_parameters.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string", "description": "The cluster name to edit"},
				"field": map[string]any{
					"type":        "string",
					"description": "The field to edit (e.g. version, nodes, controlPlaneReplicas, groups, workerGroups, or a parameter key)",
				},
				"value": map[string]any{
					"description": "The new value. Use a string for version/groups/parameters, an integer for nodes/controlPlaneReplicas, or a JSON array for workerGroups.",
				},
			},
			"required":             []string{"name", "field", "value"},
			"additionalProperties": false,
		},
	}
}

// --- Tool handlers (take parsed input map directly) ---

func handleListClusters(_ context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	clusters := deps.watcher.GetClustersForUser(deps.user.Groups)
	if len(clusters) == 0 {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "No clusters found."}},
		}, nil, nil
	}

	type clusterSummary struct {
		Name                 string `json:"name"`
		Phase                string `json:"phase"`
		Version              string `json:"version"`
		Nodes                int32  `json:"nodes"`
		ControlPlaneReplicas int32  `json:"controlPlaneReplicas"`
		Ready                bool   `json:"ready"`
		ReadOnly             bool   `json:"readOnly"`
	}

	summaries := make([]clusterSummary, len(clusters))
	for i, c := range clusters {
		summaries[i] = clusterSummary{
			Name:                 c.Name,
			Phase:                c.Phase,
			Version:              c.Version,
			Nodes:                c.Nodes,
			ControlPlaneReplicas: c.ControlPlaneReplicas,
			Ready:                c.Ready,
			ReadOnly:             c.ReadOnly,
		}
	}

	data, err := json.MarshalIndent(summaries, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal clusters: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, summaries, nil
}

func handleDescribeCluster(_ context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	name, _ := input["name"].(string)
	if name == "" {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'name' is required"}},
		}, nil, nil
	}

	target, found := deps.findCluster(name)
	if !found {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Cluster %q not found or not visible to you", name)}},
		}, nil, nil
	}

	data, err := json.MarshalIndent(target, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal cluster: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, target, nil
}

func handleGetVersions(_ context.Context, _ *mcp.CallToolRequest, _ map[string]any, _ *toolDeps) (*mcp.CallToolResult, any, error) {
	versions := viper.GetStringSlice("cluster.available_versions")
	if len(versions) == 0 {
		versions = []string{"v1.34.0", "v1.33.2", "v1.32.5", "v1.31.8"}
	}

	data, err := json.MarshalIndent(versions, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal versions: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, versions, nil
}

func handleGetLimits(_ context.Context, _ *mcp.CallToolRequest, _ map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	maxClusters := viper.GetInt("cluster.limits.max_clusters")
	maxTotalNodes := viper.GetInt("cluster.limits.max_total_nodes")
	maxTotalCP := viper.GetInt("cluster.limits.max_total_cp")

	allClusters := deps.watcher.GetClustersForUser(deps.user.Groups)
	currentClusters := 0
	var currentNodes, currentCP int32

	for _, c := range allClusters {
		if !c.ReadOnly {
			currentClusters++
			currentNodes += c.Nodes
			currentCP += c.ControlPlaneReplicas
		}
	}

	type limitInfo struct {
		MaxClusters     int   `json:"maxClusters"`
		CurrentClusters int   `json:"currentClusters"`
		MaxTotalNodes   int   `json:"maxTotalNodes"`
		CurrentNodes    int32 `json:"currentNodes"`
		MaxTotalCP      int   `json:"maxTotalControlPlaneReplicas"`
		CurrentCP       int32 `json:"currentControlPlaneReplicas"`
	}

	limits := limitInfo{
		MaxClusters:     maxClusters,
		CurrentClusters: currentClusters,
		MaxTotalNodes:   maxTotalNodes,
		CurrentNodes:    currentNodes,
		MaxTotalCP:      maxTotalCP,
		CurrentCP:       currentCP,
	}

	data, err := json.MarshalIndent(limits, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal limits: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, limits, nil
}

func handleGetParameters(_ context.Context, _ *mcp.CallToolRequest, _ map[string]any, _ *toolDeps) (*mcp.CallToolResult, any, error) {
	template := viper.GetString("cluster.template")
	params := cluster.DiscoverParameters(template)
	paramDefaults := cluster.GetParameterDefaults()

	type paramInfo struct {
		Key         string               `json:"key"`
		Label       string               `json:"label"`
		Description string               `json:"description"`
		Type        string               `json:"type"`
		Default     string               `json:"default"`
		Editable    bool                 `json:"editable"`
		Options     []cluster.OptionItem `json:"options,omitempty"`
		Min         *int                 `json:"min,omitempty"`
		Max         *int                 `json:"max,omitempty"`
	}

	infos := make([]paramInfo, len(params))
	for i, p := range params {
		def := p.Default
		if def == "" {
			def = paramDefaults[p.Key]
		}
		infos[i] = paramInfo{
			Key:         p.Key,
			Label:       p.Label,
			Description: p.Description,
			Type:        p.Type,
			Default:     def,
			Editable:    p.Editable,
			Options:     p.Options,
			Min:         p.Min,
			Max:         p.Max,
		}
	}

	data, err := json.MarshalIndent(infos, "", "  ")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal parameters: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, infos, nil
}

func handlePreviewCluster(ctx context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	cr, err := parseCreateRequest(input)
	if err != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error: %v", err)}},
		}, nil, nil
	}

	yaml, err := deps.manager.PreviewCluster(ctx, *cr)
	if err != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Preview failed: %v", err)}},
		}, nil, nil
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: yaml}},
	}, yaml, nil
}

func handleCreateCluster(ctx context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	cr, err := parseCreateRequest(input)
	if err != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error: %v", err)}},
		}, nil, nil
	}

	if !clusterNameRegex.MatchString(cr.Name) {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "Invalid cluster name. Must be lowercase alphanumeric with hyphens (e.g. my-cluster)"}},
		}, nil, nil
	}

	if bad := validateGroupNames(parseGroupsString(cr.Groups)); bad != "" {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Invalid group name: %q — only letters, digits and _.:/@- are allowed", bad)}},
		}, nil, nil
	}

	adminGroups := viper.GetStringSlice("cluster.admin_groups")
	if len(adminGroups) == 0 {
		adminGroups = []string{"cluster-admin"}
	}

	isAdmin := auth.CheckUserGroups(deps.user.Groups, adminGroups)

	if !isAdmin {
		creatorGroups := viper.GetStringSlice("cluster.creator_groups")
		if len(creatorGroups) == 0 {
			creatorGroups = adminGroups
		}
		if !auth.CheckUserGroups(deps.user.Groups, creatorGroups) {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "You don't have permission to create clusters"}},
			}, nil, nil
		}

		if cr.Groups == "" {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "You must assign at least one group to the cluster"}},
			}, nil, nil
		}

		requestedGroups := parseGroupsString(cr.Groups)
		userGroupMap := make(map[string]bool)
		for _, g := range deps.user.Groups {
			userGroupMap[g] = true
		}
		for _, g := range requestedGroups {
			if !userGroupMap[g] {
				return &mcp.CallToolResult{
					IsError: true,
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("You can only assign groups you belong to. Invalid: %s", g)}},
				}, nil, nil
			}
		}
	}

	cr.Creator = deps.user.Username

	if err := deps.manager.CreateCluster(ctx, *cr); err != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Failed to create cluster: %v", err)}},
		}, nil, nil
	}

	deps.watcher.RefreshAndBroadcast(ctx)

	result := map[string]string{
		"status": "created",
		"name":   cr.Name,
		"user":   deps.user.Username,
	}
	data, _ := json.MarshalIndent(result, "", "  ")

	slog.Info("Cluster created via MCP", "username", deps.user.Username, "cluster_name", cr.Name)

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}, result, nil
}

func handleDeleteCluster(_ context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	name, _ := input["name"].(string)
	if name == "" {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'name' is required"}},
		}, nil, nil
	}

	target, found := deps.findCluster(name)
	if !found {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Cluster %q not found or not visible to you", name)}},
		}, nil, nil
	}

	if !deps.canModify(target) {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "You don't have permission to delete this cluster"}},
		}, nil, nil
	}

	if err := deps.manager.DeleteCluster(context.Background(), target.Name, target.Namespace); err != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Failed to delete cluster: %v", err)}},
		}, nil, nil
	}

	deps.watcher.RefreshAndBroadcast(context.Background())

	slog.Info("Cluster deleted via MCP", "username", deps.user.Username, "cluster_name", name)

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Cluster %q deleted successfully", name)}},
	}, nil, nil
}

func handleEditCluster(ctx context.Context, _ *mcp.CallToolRequest, input map[string]any, deps *toolDeps) (*mcp.CallToolResult, any, error) {
	name, _ := input["name"].(string)
	field, _ := input["field"].(string)
	value := input["value"]

	if name == "" || field == "" {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'name' and 'field' are required"}},
		}, nil, nil
	}

	target, found := deps.findCluster(name)
	if !found {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Cluster %q not found or not visible to you", name)}},
		}, nil, nil
	}

	if !deps.canModify(target) {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: "You don't have permission to edit this cluster"}},
		}, nil, nil
	}

	var editErr error
	switch field {
	case "version":
		version, ok := value.(string)
		if !ok {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'value' must be a string for version"}},
			}, nil, nil
		}
		editErr = deps.manager.UpdateClusterVersion(ctx, target.Name, target.Namespace, version)

	case "nodes":
		nodes, ok := toInt32(value)
		if !ok {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'value' must be an integer for nodes"}},
			}, nil, nil
		}
		editErr = deps.manager.UpdateClusterNodeCount(ctx, target.Name, target.Namespace, nodes)

	case "controlPlaneReplicas":
		replicas, ok := toInt32(value)
		if !ok {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'value' must be an integer for controlPlaneReplicas"}},
			}, nil, nil
		}
		editErr = deps.manager.UpdateClusterControlPlaneReplicas(ctx, target.Name, target.Namespace, replicas)

	case "groups":
		groups, ok := value.(string)
		if !ok {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'value' must be a string for groups"}},
			}, nil, nil
		}
		if bad := validateGroupNames(parseGroupsString(groups)); bad != "" {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Invalid group name: %q", bad)}},
			}, nil, nil
		}
		editErr = deps.manager.UpdateClusterGroups(ctx, target.Name, target.Namespace, groups)

	case "workerGroups":
		var workerGroups []cluster.WorkerGroup
		switch v := value.(type) {
		case string:
			if err := json.Unmarshal([]byte(v), &workerGroups); err != nil {
				return &mcp.CallToolResult{
					IsError: true,
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error: invalid workerGroups JSON: %v", err)}},
				}, nil, nil
			}
		case []any:
			raw, _ := json.Marshal(v)
			if err := json.Unmarshal(raw, &workerGroups); err != nil {
				return &mcp.CallToolResult{
					IsError: true,
					Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error: invalid workerGroups: %v", err)}},
				}, nil, nil
			}
		default:
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: "Error: 'value' must be a JSON array for workerGroups"}},
			}, nil, nil
		}
		editErr = deps.manager.UpdateClusterWorkerGroups(ctx, target.Name, target.Namespace, workerGroups)

	default:
		rawStr, ok := value.(string)
		if !ok {
			rawStr = fmt.Sprintf("%v", value)
		}
		editErr = deps.manager.UpdateClusterParameter(ctx, target.Name, target.Namespace, field, rawStr)
	}

	if editErr != nil {
		return &mcp.CallToolResult{
			IsError: true,
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Failed to edit %q: %v", field, editErr)}},
		}, nil, nil
	}

	deps.watcher.RefreshAndBroadcast(ctx)

	slog.Info("Cluster edited via MCP", "username", deps.user.Username, "cluster_name", name, "field", field)

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Field %q updated successfully on cluster %q", field, name)}},
	}, nil, nil
}

// --- Helpers ---

func parseCreateRequest(args map[string]any) (*cluster.CreateClusterRequest, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return nil, fmt.Errorf("'name' is required")
	}

	cr := &cluster.CreateClusterRequest{Name: name}

	if v, ok := args["version"].(string); ok {
		cr.Version = v
	}
	if v, ok := args["groups"].(string); ok {
		cr.Groups = v
	}
	if v, ok := args["nodes"]; ok {
		if n, ok := toInt32(v); ok {
			cr.Nodes = n
		}
	}
	if v, ok := args["controlPlaneReplicas"]; ok {
		if n, ok := toInt32(v); ok {
			cr.ControlPlaneReplicas = n
		}
	}
	if v, ok := args["parameters"].(map[string]any); ok {
		cr.Parameters = make(map[string]string, len(v))
		for k, val := range v {
			cr.Parameters[k] = fmt.Sprintf("%v", val)
		}
	}

	return cr, nil
}

func toInt32(v any) (int32, bool) {
	switch n := v.(type) {
	case float64:
		return int32(n), true
	case int:
		return int32(n), true
	case int32:
		return n, true
	case int64:
		return int32(n), true
	case string:
		if i, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
			return int32(i), true
		}
	}
	return 0, false
}

func parseGroupsString(groupsStr string) []string {
	if groupsStr == "" {
		return nil
	}
	var groups []string
	for group := range strings.SplitSeq(groupsStr, ",") {
		trimmed := strings.TrimSpace(group)
		if trimmed != "" {
			groups = append(groups, trimmed)
		}
	}
	return groups
}

var groupNameRegex = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,253}$`)

func validateGroupNames(groups []string) string {
	for _, g := range groups {
		if !groupNameRegex.MatchString(g) {
			return g
		}
	}
	return ""
}
