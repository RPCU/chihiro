package watcher

import (
	"reflect"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestParseClusterDetailsV1beta2(t *testing.T) {
	spec := map[string]interface{}{
		"paused":            true,
		"infrastructureRef": map[string]interface{}{"apiGroup": "infrastructure.cluster.x-k8s.io", "kind": "OpenStackCluster", "name": "dev-1"},
		"controlPlaneRef":   map[string]interface{}{"apiGroup": "controlplane.cluster.x-k8s.io", "kind": "KubeadmControlPlane", "name": "dev-1-cp"},
		"topology":          map[string]interface{}{"classRef": map[string]interface{}{"name": "openstack-class"}},
	}
	status := map[string]interface{}{
		"conditions": []interface{}{
			map[string]interface{}{"type": "Available", "status": "True"},
			map[string]interface{}{
				"type": "WorkersAvailable", "status": "False", "reason": "NotAvailable", "message": "1 replica unavailable",
				"lastTransitionTime": "2026-09-01T10:00:00Z",
			},
			map[string]interface{}{"status": "True"},
		},
		"controlPlane":   map[string]interface{}{"desiredReplicas": int64(3), "replicas": int64(3), "readyReplicas": int64(2)},
		"workers":        map[string]interface{}{},
		"failureDomains": []interface{}{map[string]interface{}{"name": "az-2"}, map[string]interface{}{"name": "az-1"}},
	}

	info := &ClusterInfo{}
	parseClusterDetails(info, spec, status)

	if len(info.Conditions) != 2 || info.Conditions[0].Type != "WorkersAvailable" || info.Conditions[0].LastTransitionTime == nil {
		t.Errorf("conditions = %+v", info.Conditions)
	}
	cp := info.ControlPlaneStatus
	if cp == nil || *cp.Desired != 3 || *cp.Ready != 2 || cp.Available != nil {
		t.Errorf("controlPlaneStatus = %+v", cp)
	}
	if info.WorkersStatus != nil {
		t.Errorf("empty workers block should be nil, got %+v", info.WorkersStatus)
	}
	if !reflect.DeepEqual(info.FailureDomains, []string{"az-1", "az-2"}) {
		t.Errorf("failureDomains = %v", info.FailureDomains)
	}
	if info.ClusterClass != "openstack-class" || !info.Paused {
		t.Errorf("class/paused = %q %v", info.ClusterClass, info.Paused)
	}
	if info.InfrastructureRef == nil || info.InfrastructureRef.Kind != "OpenStackCluster" || info.ControlPlaneRef.Name != "dev-1-cp" {
		t.Errorf("refs = %+v %+v", info.InfrastructureRef, info.ControlPlaneRef)
	}
}

func TestParseClusterDetailsV1beta1(t *testing.T) {
	spec := map[string]interface{}{"topology": map[string]interface{}{"class": "legacy-class"}}
	status := map[string]interface{}{
		"failureDomains": map[string]interface{}{"zone-b": map[string]interface{}{}, "zone-a": map[string]interface{}{}},
	}
	info := &ClusterInfo{}
	parseClusterDetails(info, spec, status)
	if info.ClusterClass != "legacy-class" || !reflect.DeepEqual(info.FailureDomains, []string{"zone-a", "zone-b"}) {
		t.Errorf("got class %q domains %v", info.ClusterClass, info.FailureDomains)
	}
	if info.ControlPlaneStatus != nil || info.Conditions != nil {
		t.Errorf("expected no v1beta2 status, got %+v %+v", info.ControlPlaneStatus, info.Conditions)
	}
}

func machine(name string, labels map[string]interface{}, spec, status map[string]interface{}) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{"name": name, "namespace": "capi-system", "labels": labels},
		"spec":     spec,
		"status":   status,
	}}
}

func TestParseMachines(t *testing.T) {
	worker := parseMachine(machine("dev-1-md-0-abc",
		map[string]interface{}{machineClusterNameLabel: "dev-1", machineDeploymentLabel: "dev-1-md-0"},
		map[string]interface{}{"version": "v1.31.2", "failureDomain": "az-1", "providerID": "openstack:///123"},
		map[string]interface{}{
			"phase":   "Running",
			"nodeRef": map[string]interface{}{"name": "dev-1-md-0-abc"},
			"addresses": []interface{}{
				map[string]interface{}{"type": "ExternalIP", "address": "1.2.3.4"},
				map[string]interface{}{"type": "InternalDNS", "address": "node.local"},
				map[string]interface{}{"type": "InternalIP", "address": "10.0.0.5"},
			},
			"nodeInfo":   map[string]interface{}{"osImage": "Ubuntu 24.04", "architecture": "amd64"},
			"conditions": []interface{}{map[string]interface{}{"type": "Ready", "status": "True"}},
		}))
	if worker.Role != "worker" || worker.Group != "dev-1-md-0" || worker.NodeName != "dev-1-md-0-abc" {
		t.Errorf("worker = %+v", worker)
	}
	if !reflect.DeepEqual(worker.Addresses, []string{"10.0.0.5", "1.2.3.4"}) {
		t.Errorf("addresses = %v", worker.Addresses)
	}
	if worker.Ready == nil || !*worker.Ready || worker.OSImage != "Ubuntu 24.04" {
		t.Errorf("ready/os = %v %q", worker.Ready, worker.OSImage)
	}

	cp := parseMachine(machine("dev-1-cp-xyz",
		map[string]interface{}{machineClusterNameLabel: "dev-1", machineControlPlaneLabel: ""},
		map[string]interface{}{},
		map[string]interface{}{
			"phase":      "Provisioning",
			"conditions": []interface{}{map[string]interface{}{"type": "Ready", "status": "False", "reason": "WaitingForBootstrap"}},
		}))
	if cp.Role != "control-plane" || cp.Ready == nil || *cp.Ready || cp.Message != "WaitingForBootstrap" {
		t.Errorf("cp = %+v", cp)
	}

	machines := []Machine{worker, {Name: "a", Role: "worker", Group: "dev-1-md-0"}, cp}
	sortMachines(machines)
	if machines[0].Name != "dev-1-cp-xyz" || machines[1].Name != "a" {
		t.Errorf("order = %v, %v, %v", machines[0].Name, machines[1].Name, machines[2].Name)
	}
}
