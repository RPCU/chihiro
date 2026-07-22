package cmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/spf13/cobra"
)

var clusterDeleteCmd = &cobra.Command{
	Use:   "delete [name]",
	Short: "Delete a CAPI workload cluster",
	Long:  `Delete a CAPI workload cluster managed by Chihiro.`,
	Args:  cobra.ExactArgs(1),
	RunE:  runClusterDelete,
}

func init() {
	clusterDeleteCmd.Flags().StringP("namespace", "n", "capi-system", "namespace of the cluster")
	clusterDeleteCmd.Flags().BoolP("yes", "y", false, "skip confirmation prompt")

	clusterCmd.AddCommand(clusterDeleteCmd)
}

func runClusterDelete(cmd *cobra.Command, args []string) error {
	client, _, gvr, err := newCAPIClient()
	if err != nil {
		return err
	}

	name := args[0]
	namespace, _ := cmd.Flags().GetString("namespace")
	yes, _ := cmd.Flags().GetBool("yes")

	if !yes {
		fmt.Printf("Are you sure you want to delete cluster %q in namespace %q? [y/N] ", name, namespace)
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		if strings.TrimSpace(strings.ToLower(answer)) != "y" {
			fmt.Println("Aborted.")
			return nil
		}
	}

	manager := cluster.NewManager(client, gvr)
	if err := manager.DeleteCluster(context.TODO(), name, namespace); err != nil {
		return fmt.Errorf("failed to delete cluster: %w", err)
	}

	fmt.Printf("Cluster %q deleted from namespace %q\n", name, namespace)
	return nil
}
