package watcher

import (
	"context"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
)

const (
	machineClusterNameLabel  = "cluster.x-k8s.io/cluster-name"
	machineControlPlaneLabel = "cluster.x-k8s.io/control-plane"
	machineDeploymentLabel   = "cluster.x-k8s.io/deployment-name"
	machinePoolLabel         = "cluster.x-k8s.io/pool-name"
)

// Machine is the read-only view of a CAPI Machine shown on the cluster page.
type Machine struct {
	Name string `json:"name"`
	// Role is "control-plane" or "worker".
	Role string `json:"role"`
	// Group is the owning MachineDeployment (or MachinePool) name, empty for
	// control plane machines.
	Group         string     `json:"group,omitempty"`
	Phase         string     `json:"phase,omitempty"`
	Version       string     `json:"version,omitempty"`
	NodeName      string     `json:"nodeName,omitempty"`
	ProviderID    string     `json:"providerID,omitempty"`
	FailureDomain string     `json:"failureDomain,omitempty"`
	Addresses     []string   `json:"addresses,omitempty"`
	Ready         *bool      `json:"ready,omitempty"`
	OSImage       string     `json:"osImage,omitempty"`
	Architecture  string     `json:"architecture,omitempty"`
	Message       string     `json:"message,omitempty"`
	Deleting      bool       `json:"deleting,omitempty"`
	CreatedAt     *time.Time `json:"createdAt,omitempty"`
}

// ListMachines lists the Machines of a cluster (by the cluster-name label, in
// the cluster's namespace). Callers must have checked the user may see the
// cluster.
func (cw *ClusterWatcher) ListMachines(ctx context.Context, namespace, clusterName string) ([]Machine, error) {
	gvr, err := cw.resolver.GVRFor(cw.clusterGVR.Group, "machines", cw.clusterGVR.Version)
	if err != nil {
		return nil, err
	}
	selector := labels.Set{machineClusterNameLabel: clusterName}.AsSelector().String()
	list, err := cw.client.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	machines := make([]Machine, 0, len(list.Items))
	for i := range list.Items {
		machines = append(machines, parseMachine(&list.Items[i]))
	}
	sortMachines(machines)
	return machines, nil
}

// sortMachines orders control plane machines first, then workers by group,
// then by name.
func sortMachines(machines []Machine) {
	sort.SliceStable(machines, func(i, j int) bool {
		a, b := machines[i], machines[j]
		if a.Role != b.Role {
			return a.Role == "control-plane"
		}
		if a.Group != b.Group {
			return a.Group < b.Group
		}
		return a.Name < b.Name
	})
}

func parseMachine(obj *unstructured.Unstructured) Machine {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	status, _ := obj.Object["status"].(map[string]interface{})
	objLabels := obj.GetLabels()

	m := Machine{
		Name:     obj.GetName(),
		Role:     "worker",
		Deleting: obj.GetDeletionTimestamp() != nil,
	}
	if ts := obj.GetCreationTimestamp(); !ts.IsZero() {
		t := ts.Time
		m.CreatedAt = &t
	}
	if _, ok := objLabels[machineControlPlaneLabel]; ok {
		m.Role = "control-plane"
	} else if g := objLabels[machineDeploymentLabel]; g != "" {
		m.Group = g
	} else {
		m.Group = objLabels[machinePoolLabel]
	}

	m.Version, _ = spec["version"].(string)
	m.ProviderID, _ = spec["providerID"].(string)
	m.FailureDomain, _ = spec["failureDomain"].(string)
	m.Phase, _ = status["phase"].(string)
	if nodeRef, ok := status["nodeRef"].(map[string]interface{}); ok {
		m.NodeName, _ = nodeRef["name"].(string)
	}
	if nodeInfo, ok := status["nodeInfo"].(map[string]interface{}); ok {
		m.OSImage, _ = nodeInfo["osImage"].(string)
		m.Architecture, _ = nodeInfo["architecture"].(string)
	}
	if addrs, ok := status["addresses"].([]interface{}); ok {
		// Internal addresses first: they're what operators usually look for.
		var internal, other []string
		for _, a := range addrs {
			am, ok := a.(map[string]interface{})
			if !ok {
				continue
			}
			addr, _ := am["address"].(string)
			typ, _ := am["type"].(string)
			switch {
			case addr == "" || typ == "InternalDNS" || typ == "ExternalDNS" || typ == "Hostname":
				continue
			case typ == "InternalIP":
				internal = append(internal, addr)
			default:
				other = append(other, addr)
			}
		}
		m.Addresses = append(internal, other...)
	}

	for _, c := range parseConditions(status) {
		if c.Type != "Ready" {
			continue
		}
		ready := c.Status == "True"
		m.Ready = &ready
		if !ready {
			m.Message = c.Message
			if m.Message == "" {
				m.Message = c.Reason
			}
		}
	}
	if msg, ok := status["failureMessage"].(string); ok && msg != "" {
		m.Message = msg
	}
	return m
}
