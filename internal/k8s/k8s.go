package k8s

import (
	"fmt"
	"os"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// NewClients builds a Kubernetes dynamic client and rest.Config from the given
// kubeconfig path. If kubeconfig is empty, it falls back to the KUBECONFIG
// environment variable, then to in-cluster config.
func NewClients(kubeconfig string) (dynamic.Interface, *rest.Config, error) {
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
		return nil, nil, fmt.Errorf("failed to create kubernetes config: %w", err)
	}

	client, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	return client, config, nil
}
