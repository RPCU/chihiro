package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/Bealvio/chihiro/internal/kubeconfig"
	"github.com/Bealvio/chihiro/internal/watcher"
	"github.com/spf13/cobra"
)

var clusterKubeconfigCmd = &cobra.Command{
	Use:   "kubeconfig [name]",
	Short: "Generate an OIDC kubeconfig for a cluster",
	Long: `Generate a kubeconfig file for a CAPI workload cluster. The
generated kubeconfig uses the OIDC exec plugin for authentication
and embeds the cluster CA certificate.

Examples:
  chihiro cluster kubeconfig my-cluster --username user --config=config.yaml
  chihiro cluster kubeconfig my-cluster --username user --groups dev,ops --config=config.yaml
  chihiro cluster kubeconfig my-cluster --username user --output kubeconfig.yaml --config=config.yaml`,
	Args: cobra.ExactArgs(1),
	RunE: runClusterKubeconfig,
}

func init() {
	clusterKubeconfigCmd.Flags().StringP("username", "u", "", "username for the kubeconfig (required)")
	clusterKubeconfigCmd.Flags().StringSliceP("groups", "g", nil, "OIDC groups (comma-separated or repeatable)")
	clusterKubeconfigCmd.Flags().StringP("namespace", "n", "capi-system", "namespace of the cluster")
	clusterKubeconfigCmd.Flags().StringP("output", "o", "", "write kubeconfig to file instead of stdout")

	_ = clusterKubeconfigCmd.MarkFlagRequired("username")

	clusterCmd.AddCommand(clusterKubeconfigCmd)
}

func runClusterKubeconfig(cmd *cobra.Command, args []string) error {
	clusterName := args[0]
	username, _ := cmd.Flags().GetString("username")
	groups, _ := cmd.Flags().GetStringSlice("groups")
	namespace, _ := cmd.Flags().GetString("namespace")
	output, _ := cmd.Flags().GetString("output")

	// Normalize groups: split comma-separated entries so --groups "a,b"
	// works identically to --groups a --groups b.
	groups = normalizeGroups(groups)

	client, resolver, _, err := newCAPIClient()
	if err != nil {
		return err
	}

	gen := kubeconfig.NewGenerator(client, resolver)

	clusterInfo := &watcher.ClusterInfo{
		Name:      clusterName,
		Namespace: namespace,
	}

	fmt.Fprintf(os.Stderr, "Generating kubeconfig for cluster %q (this may take up to 90s if the control plane is provisioning)...\n", clusterName)

	kubeconfigYAML, err := gen.GenerateKubeconfig(context.TODO(), clusterInfo, username, groups)
	if err != nil {
		return fmt.Errorf("failed to generate kubeconfig: %w", err)
	}

	if output != "" {
		if err := os.WriteFile(output, []byte(kubeconfigYAML), 0o600); err != nil {
			return fmt.Errorf("failed to write kubeconfig to %s: %w", output, err)
		}
		fmt.Fprintf(os.Stderr, "Kubeconfig written to %s\n", output)
		return nil
	}

	fmt.Print(kubeconfigYAML)
	return nil
}

// normalizeGroups flattens comma-separated group entries into individual items.
func normalizeGroups(raw []string) []string {
	var out []string
	for _, g := range raw {
		for _, part := range strings.Split(g, ",") {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}
