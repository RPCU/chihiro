package watcher

import (
	"sort"
	"time"
)

// Condition is one entry of a CAPI object's status.conditions. Both the
// v1beta1 (with severity) and v1beta2 (metav1.Condition) shapes are accepted.
type Condition struct {
	Type               string     `json:"type"`
	Status             string     `json:"status"`
	Reason             string     `json:"reason,omitempty"`
	Message            string     `json:"message,omitempty"`
	Severity           string     `json:"severity,omitempty"`
	LastTransitionTime *time.Time `json:"lastTransitionTime,omitempty"`
}

// ObjectRef names a provider object referenced by the Cluster
// (spec.infrastructureRef, spec.controlPlaneRef).
type ObjectRef struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// ReplicaStatus is the v1beta2 replica summary CAPI reports for the control
// plane (status.controlPlane) and the workers (status.workers). A nil field
// means the controller doesn't report it.
type ReplicaStatus struct {
	Desired   *int32 `json:"desired,omitempty"`
	Current   *int32 `json:"current,omitempty"`
	Ready     *int32 `json:"ready,omitempty"`
	Available *int32 `json:"available,omitempty"`
	UpToDate  *int32 `json:"upToDate,omitempty"`
}

// parseConditions reads status.conditions, sorted so that conditions needing
// attention (not True) come first, then by type.
func parseConditions(status map[string]interface{}) []Condition {
	items, ok := status["conditions"].([]interface{})
	if !ok {
		return nil
	}
	out := make([]Condition, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		c := Condition{}
		c.Type, _ = m["type"].(string)
		if c.Type == "" {
			continue
		}
		c.Status, _ = m["status"].(string)
		c.Reason, _ = m["reason"].(string)
		c.Message, _ = m["message"].(string)
		c.Severity, _ = m["severity"].(string)
		if ts, ok := m["lastTransitionTime"].(string); ok {
			if t, err := time.Parse(time.RFC3339, ts); err == nil {
				c.LastTransitionTime = &t
			}
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		ti, tj := out[i].Status == "True", out[j].Status == "True"
		if ti != tj {
			return !ti
		}
		return out[i].Type < out[j].Type
	})
	return out
}

// parseReplicaStatus reads a v1beta2 replica summary (status.controlPlane or
// status.workers). It returns nil when the block is absent or empty, e.g. on
// v1beta1 clusters.
func parseReplicaStatus(v interface{}) *ReplicaStatus {
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	field := func(key string) *int32 {
		raw, exists := m[key]
		if !exists {
			return nil
		}
		n := int32(toInt(raw))
		return &n
	}
	rs := &ReplicaStatus{
		Desired:   field("desiredReplicas"),
		Current:   field("replicas"),
		Ready:     field("readyReplicas"),
		Available: field("availableReplicas"),
		UpToDate:  field("upToDateReplicas"),
	}
	if rs.Desired == nil && rs.Current == nil && rs.Ready == nil && rs.Available == nil && rs.UpToDate == nil {
		return nil
	}
	return rs
}

func parseObjectRef(v interface{}) *ObjectRef {
	m, ok := v.(map[string]interface{})
	if !ok {
		return nil
	}
	ref := &ObjectRef{}
	ref.Kind, _ = m["kind"].(string)
	ref.Name, _ = m["name"].(string)
	if ref.Kind == "" && ref.Name == "" {
		return nil
	}
	return ref
}

// parseClusterClass returns the ClusterClass a topology-managed cluster uses:
// spec.topology.classRef.name (v1beta2) or spec.topology.class (v1beta1).
func parseClusterClass(spec map[string]interface{}) string {
	topology, ok := spec["topology"].(map[string]interface{})
	if !ok {
		return ""
	}
	if ref, ok := topology["classRef"].(map[string]interface{}); ok {
		if name, ok := ref["name"].(string); ok && name != "" {
			return name
		}
	}
	class, _ := topology["class"].(string)
	return class
}

// parseFailureDomains lists the failure domain names in status.failureDomains,
// a list of {name, ...} in v1beta2 and a map keyed by name in v1beta1.
func parseFailureDomains(status map[string]interface{}) []string {
	var names []string
	switch fd := status["failureDomains"].(type) {
	case []interface{}:
		for _, item := range fd {
			if m, ok := item.(map[string]interface{}); ok {
				if name, ok := m["name"].(string); ok && name != "" {
					names = append(names, name)
				}
			}
		}
	case map[string]interface{}:
		for name := range fd {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// parseClusterDetails fills the structured status fields shown on the
// cluster page from the raw Cluster spec and status.
func parseClusterDetails(info *ClusterInfo, spec, status map[string]interface{}) {
	info.Conditions = parseConditions(status)
	info.ControlPlaneStatus = parseReplicaStatus(status["controlPlane"])
	info.WorkersStatus = parseReplicaStatus(status["workers"])
	info.FailureDomains = parseFailureDomains(status)
	info.ClusterClass = parseClusterClass(spec)
	info.InfrastructureRef = parseObjectRef(spec["infrastructureRef"])
	info.ControlPlaneRef = parseObjectRef(spec["controlPlaneRef"])
	info.Paused, _ = spec["paused"].(bool)
}
