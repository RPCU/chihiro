package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var clusterCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a CAPI workload cluster",
	Long: `Create a CAPI workload cluster managed by Chihiro.

Use --discover to list the form fields without creating anything.
Use --dry-run to preview the rendered YAML without applying it.

Examples:
  chihiro cluster create --name test --version v1.34.0 --config=config.yaml
  chihiro cluster create --discover --config=config.yaml
  chihiro cluster create --name test --version v1.34.0 --dry-run --config=config.yaml
  chihiro cluster create --name test --version v1.34.0 --param team=backend --config=config.yaml`,
	RunE: runClusterCreate,
}

func init() {
	clusterCreateCmd.Flags().StringP("name", "", "", "name of the cluster to create")
	clusterCreateCmd.Flags().StringP("namespace", "n", "capi-system", "target namespace for the cluster")
	clusterCreateCmd.Flags().StringP("version", "v", "", "Kubernetes version (e.g. v1.30.0)")
	clusterCreateCmd.Flags().Int32P("nodes", "", 1, "number of worker nodes")
	clusterCreateCmd.Flags().Int32P("control-plane-replicas", "", 3, "number of control plane replicas")
	clusterCreateCmd.Flags().StringP("groups", "g", "", "comma-separated list of allowed groups")
	clusterCreateCmd.Flags().StringSliceP("param", "p", nil, "template parameter as key=value (repeatable)")
	clusterCreateCmd.Flags().BoolP("discover", "", false, "show form fields instead of creating")
	clusterCreateCmd.Flags().BoolP("dry-run", "", false, "preview the rendered YAML without applying")

	clusterCmd.AddCommand(clusterCreateCmd)
}

func runClusterCreate(cmd *cobra.Command, _ []string) error {
	discover, _ := cmd.Flags().GetBool("discover")
	if discover {
		return runCreateDiscover()
	}

	name, _ := cmd.Flags().GetString("name")
	if name == "" {
		return fmt.Errorf("--name is required (e.g. --name my-cluster)")
	}

	client, _, gvr, err := newCAPIClient()
	if err != nil {
		return err
	}

	namespace, _ := cmd.Flags().GetString("namespace")
	version, _ := cmd.Flags().GetString("version")
	nodes, _ := cmd.Flags().GetInt32("nodes")
	cpReplicas, _ := cmd.Flags().GetInt32("control-plane-replicas")
	groups, _ := cmd.Flags().GetString("groups")
	paramSlice, _ := cmd.Flags().GetStringSlice("param")
	dryRun, _ := cmd.Flags().GetBool("dry-run")

	params := parseParams(paramSlice)

	manager := cluster.NewManager(client, gvr)
	req := cluster.CreateClusterRequest{
		Name:                 name,
		Namespace:            namespace,
		Version:              version,
		Nodes:                nodes,
		ControlPlaneReplicas: cpReplicas,
		Groups:               groups,
		Parameters:           params,
	}

	if dryRun {
		yamlOut, err := manager.PreviewCluster(context.TODO(), req)
		if err != nil {
			return fmt.Errorf("failed to preview cluster: %w", err)
		}
		fmt.Print(yamlOut)
		return nil
	}

	if err := manager.CreateCluster(context.TODO(), req); err != nil {
		return fmt.Errorf("failed to create cluster: %w", err)
	}

	fmt.Printf("Cluster %q created in namespace %q\n", name, namespace)
	return nil
}

// runCreateDiscover shows the form fields for cluster creation. It is identical
// to `chihiro cluster discover` but accessible as `create --discover` for
// convenience.
func runCreateDiscover() error {
	templateStr := viper.GetString("cluster.template")
	if templateStr == "" {
		return fmt.Errorf("no cluster template configured (cluster.template)")
	}

	params := cluster.DiscoverParameters(templateStr)
	if len(params) == 0 {
		fmt.Println("No template parameters found.")
		return nil
	}

	versions := viper.GetStringSlice("cluster.available_versions")
	if len(versions) > 0 {
		fmt.Printf("Available Kubernetes versions: %s\n\n", strings.Join(versions, ", "))
	}

	tab := tabwriter.NewWriter(os.Stdout, 0, 4, 3, ' ', 0)
	fmt.Fprintln(tab, "KEY\tLABEL\tTYPE\tDEFAULT\tREQUIRED\tOPTIONS")
	for _, p := range params {
		required := "no"
		if p.Required {
			required = "yes"
		}

		var opts []string
		for _, o := range p.Options {
			opts = append(opts, o.Value)
		}
		optStr := ""
		if len(opts) > 0 {
			optStr = strings.Join(opts, ", ")
		}

		fmt.Fprintf(tab, "%s\t%s\t%s\t%s\t%s\t%s\n",
			p.Key, p.Label, p.Type, p.Default, required, optStr)
	}
	tab.Flush()
	return nil
}

// parseParams converts a slice of "key=value" strings into a map.
func parseParams(raw []string) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	out := make(map[string]string, len(raw))
	for _, kv := range raw {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			out[parts[0]] = parts[1]
		}
	}
	return out
}
