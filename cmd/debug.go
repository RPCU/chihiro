package cmd

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"

	"github.com/Bealvio/chihiro/internal/capi"
	"github.com/Bealvio/chihiro/internal/cluster"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var debugCmd = &cobra.Command{
	Use:   "debug",
	Short: "Debug cluster resources",
	Long:  `Show raw cluster resources to help debug parsing issues`,
	Run: func(cmd *cobra.Command, args []string) {
		runDebug()
	},
}

func init() {
	rootCmd.AddCommand(debugCmd)
}

func runDebug() {
	kubeconfig := viper.GetString("kubeconfig")
	if kubeconfig == "" {
		kubeconfig = os.Getenv("KUBECONFIG")
	}

	var config *rest.Config
	var err error

	if kubeconfig != "" {
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
	} else {
		config, err = rest.InClusterConfig()
	}

	if err != nil {
		slog.Error("Failed to create kubernetes config", "error", err)
		os.Exit(1)
	}

	client, err := dynamic.NewForConfig(config)
	if err != nil {
		slog.Error("Failed to create kubernetes client", "error", err)
		os.Exit(1)
	}

	resolver, err := capi.NewResolver(config)
	if err != nil {
		slog.Error("Failed to create CAPI version resolver", "error", err)
		os.Exit(1)
	}

	gvr, err := resolver.ClusterGVR()
	if err != nil {
		slog.Error("Failed to resolve Cluster API version", "error", err)
		os.Exit(1)
	}

	// Dump both kinds of cluster the dashboard surfaces: the ones chihiro
	// manages and the ones merely labelled read-only. Deduplicated by
	// namespace/name since a managed cluster can also be marked read-only.
	seen := make(map[string]bool)
	index := 0

	for _, selector := range []string{cluster.ManagedSelector, cluster.ReadOnlySelector} {
		list, err := client.Resource(gvr).List(context.TODO(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			slog.Error("Error loading clusters for debug", "selector", selector, "error", err)
			os.Exit(1)
		}

		slog.Info("Found clusters for debug", "selector", selector, "count", len(list.Items))

		for _, item := range list.Items {
			key := item.GetNamespace() + "/" + item.GetName()
			if seen[key] {
				continue
			}
			seen[key] = true
			index++

			readOnly := cluster.IsReadOnlyLabelValue(item.GetLabels()[cluster.ReadOnlyLabel])
			slog.Info(
				"Cluster debug info",
				"index", index,
				"name", item.GetName(),
				"namespace", item.GetNamespace(),
				"read_only", readOnly,
			)

			// Pretty print the raw object
			jsonData, err := json.MarshalIndent(item.Object, "", "  ")
			if err != nil {
				slog.Error("Error marshaling cluster for debug output", "cluster_name", item.GetName(), "namespace", item.GetNamespace(), "error", err)
				continue
			}

			slog.Debug("Cluster raw data", "cluster_name", item.GetName(), "namespace", item.GetNamespace(), "data", string(jsonData))
		}
	}
}
