package cmd

import (
	"fmt"

	"github.com/Bealvio/chihiro/internal/capi"
	"github.com/Bealvio/chihiro/internal/k8s"
	"github.com/spf13/viper"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// newCAPIClient builds the Kubernetes dynamic client, CAPI resolver, and
// resolved Cluster GVR in one call. Every CLI subcommand that talks to
// the management cluster uses this instead of duplicating the setup.
func newCAPIClient() (dynamic.Interface, *capi.Resolver, schema.GroupVersionResource, error) {
	client, config, err := k8s.NewClients(viper.GetString("kubeconfig"))
	if err != nil {
		return nil, nil, schema.GroupVersionResource{}, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	resolver, err := capi.NewResolver(config)
	if err != nil {
		return nil, nil, schema.GroupVersionResource{}, fmt.Errorf("failed to create CAPI version resolver: %w", err)
	}

	gvr, err := resolver.ClusterGVR()
	if err != nil {
		return nil, nil, schema.GroupVersionResource{}, fmt.Errorf("failed to resolve cluster GVR: %w", err)
	}

	return client, resolver, gvr, nil
}
