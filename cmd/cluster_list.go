package cmd

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

var clusterListCmd = &cobra.Command{
	Use:   "list",
	Short: "List CAPI workload clusters",
	Long:  `List all CAPI workload clusters managed by Chihiro.`,
	RunE:  runClusterList,
}

func init() {
	clusterListCmd.Flags().StringP("namespace", "n", "", "filter by namespace (default: all namespaces)")

	clusterCmd.AddCommand(clusterListCmd)
}

func runClusterList(cmd *cobra.Command, _ []string) error {
	client, _, gvr, err := newCAPIClient()
	if err != nil {
		return err
	}

	namespace, _ := cmd.Flags().GetString("namespace")

	var list *unstructured.UnstructuredList

	if namespace != "" {
		list, err = client.Resource(gvr).Namespace(namespace).List(context.TODO(), metav1.ListOptions{
			LabelSelector: "app.kubernetes.io/managed-by=chihiro",
		})
	} else {
		list, err = client.Resource(gvr).List(context.TODO(), metav1.ListOptions{
			LabelSelector: "app.kubernetes.io/managed-by=chihiro",
		})
	}

	if err != nil {
		return fmt.Errorf("failed to list clusters: %w", err)
	}

	tab := tabwriter.NewWriter(os.Stdout, 0, 4, 3, ' ', 0)
	fmt.Fprintln(tab, "NAME\tNAMESPACE\tPHASE\tVERSION\tNODES\tAGE")
	for _, item := range list.Items {
		name := item.GetName()
		ns := item.GetNamespace()
		spec, _ := item.Object["spec"].(map[string]interface{})
		status, _ := item.Object["status"].(map[string]interface{})
		// Phase
		phase := ""
		if p, ok := status["phase"].(string); ok {
			phase = p
		}
		version := ""
		if spec != nil {
			if topology, ok := spec["topology"].(map[string]interface{}); ok {
				if v, ok := topology["version"].(string); ok {
					version = v
				}
			}
			if version == "" {
				if v, ok := spec["version"].(string); ok {
					version = v
				}
			}
		}
		age := formatAge(item.GetCreationTimestamp().Time)
		fmt.Fprintf(tab, "%s\t%s\t%s\t%s\t%s\t%s\n",
			name, ns, phase, version, "—", age)
	}
	tab.Flush()
	return nil
}

func formatAge(t time.Time) string {
	d := time.Since(t)
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	case d >= time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d >= time.Minute:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	default:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
}
