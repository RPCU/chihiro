package cmd

import (
	"github.com/spf13/cobra"
)

var clusterCmd = &cobra.Command{
	Use:   "cluster",
	Short: "Manage CAPI workload clusters",
	Long:  `Create, list, delete CAPI workload clusters and download kubeconfigs.`,
}

func init() {
	rootCmd.AddCommand(clusterCmd)
}
