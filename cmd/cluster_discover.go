package cmd

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var clusterDiscoverCmd = &cobra.Command{
	Use:   "discover",
	Short: "Show template parameters for cluster creation",
	Long: `Discover and display the dynamic parameters defined in the cluster
template. These parameters appear as {{ chihiro.<key> }} placeholders
in the YAML template and can be supplied via --param key=value on
cluster create.`,
	RunE: runClusterDiscover,
}

func init() {
	clusterCmd.AddCommand(clusterDiscoverCmd)
}

func runClusterDiscover(_ *cobra.Command, _ []string) error {
	templateStr := viper.GetString("cluster.template")
	if templateStr == "" {
		return fmt.Errorf("no cluster template configured (cluster.template)")
	}

	params := cluster.DiscoverParameters(templateStr)
	if len(params) == 0 {
		fmt.Println("No template parameters found.")
		return nil
	}

	// Available versions header.
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
