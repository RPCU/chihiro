package sveltos

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func clusterSummary(name string, labels map[string]interface{}, spec, status map[string]interface{}) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "config.projectsveltos.io/v1beta1",
		"kind":       "ClusterSummary",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": "capi-system",
			"labels":    labels,
		},
		"spec":   spec,
		"status": status,
	}}
}

func capiSpec(profileSpec map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"clusterName":        "dev-1",
		"clusterNamespace":   "capi-system",
		"clusterType":        "Capi",
		"clusterProfileSpec": profileSpec,
	}
}

func TestParseClusterSummaryLinksProfileAndDeployments(t *testing.T) {
	obj := clusterSummary("addons-capi-dev-1",
		map[string]interface{}{clusterProfileLabel: "addons"},
		capiSpec(map[string]interface{}{
			"helmCharts": []interface{}{
				map[string]interface{}{"releaseName": "cilium", "releaseNamespace": "kube-system", "chartName": "cilium/cilium", "chartVersion": "1.16.0"},
				map[string]interface{}{"releaseName": "ingress", "releaseNamespace": "ingress", "chartName": "nginx/ingress-nginx"},
			},
			"policyRefs": []interface{}{
				map[string]interface{}{"kind": "ConfigMap", "name": "kyverno-policies", "namespace": "default"},
			},
		}),
		map[string]interface{}{
			"featureSummaries": []interface{}{
				map[string]interface{}{"featureID": "Helm", "status": "Provisioned", "lastAppliedTime": "2026-09-01T10:00:00Z"},
			},
			"helmReleaseSummaries": []interface{}{
				map[string]interface{}{"releaseName": "ingress", "releaseNamespace": "ingress", "status": "Conflict", "conflictMessage": "managed by other"},
			},
		},
	)

	s, ok := parseClusterSummary(obj)
	if !ok {
		t.Fatal("expected CAPI summary to be parsed")
	}
	if s.clusterKey != "capi-system/dev-1" {
		t.Errorf("clusterKey = %q", s.clusterKey)
	}
	p := s.profile
	if p.Kind != "ClusterProfile" || p.Name != "addons" || p.Namespace != "" || p.ClusterSummary != "addons-capi-dev-1" {
		t.Errorf("unexpected profile link: %+v", p)
	}
	if len(p.Deployments) != 3 {
		t.Fatalf("expected 3 deployments, got %d", len(p.Deployments))
	}
	cilium, ingress, cm := p.Deployments[0], p.Deployments[1], p.Deployments[2]
	if cilium.Status != "Provisioned" || cilium.Source != "cilium/cilium@1.16.0" || cilium.LastAppliedTime == nil {
		t.Errorf("unexpected cilium deployment: %+v", cilium)
	}
	if ingress.Status != "Conflict" || ingress.Message != "managed by other" {
		t.Errorf("unexpected ingress deployment: %+v", ingress)
	}
	// Resources feature has no status yet.
	if cm.FeatureID != "Resources" || cm.Kind != "ConfigMap" || cm.Status != "Provisioning" {
		t.Errorf("unexpected policyRef deployment: %+v", cm)
	}
	if p.State != StateFailed {
		t.Errorf("a Helm conflict should fail the profile, got %q", p.State)
	}
}

func TestParseClusterSummaryProfileAndFailure(t *testing.T) {
	obj := clusterSummary("p--team-capi-dev-1",
		map[string]interface{}{profileLabel: "team"},
		capiSpec(map[string]interface{}{
			"kustomizationRefs": []interface{}{
				map[string]interface{}{"kind": "GitRepository", "name": "flux", "namespace": "flux-system", "path": "./apps"},
			},
		}),
		map[string]interface{}{
			"featureSummaries": []interface{}{
				map[string]interface{}{"featureID": "Kustomize", "status": "Failed", "failureMessage": "boom"},
			},
		},
	)

	s, ok := parseClusterSummary(obj)
	if !ok {
		t.Fatal("expected summary to be parsed")
	}
	p := s.profile
	if p.Kind != "Profile" || p.Namespace != "capi-system" {
		t.Errorf("unexpected profile link: %+v", p)
	}
	d := p.Deployments[0]
	if d.Status != "Failed" || d.Message != "boom" || d.Source != "./apps" {
		t.Errorf("unexpected kustomize deployment: %+v", d)
	}
	if p.State != StateFailed {
		t.Errorf("state = %q", p.State)
	}
}

func TestParseClusterSummarySkipsSveltosClusters(t *testing.T) {
	spec := capiSpec(nil)
	spec["clusterType"] = "Sveltos"
	if _, ok := parseClusterSummary(clusterSummary("x", nil, spec, nil)); ok {
		t.Error("summaries for SveltosClusters must be ignored")
	}
}

func TestAggregateWorstStateWins(t *testing.T) {
	summaries := map[string]summary{
		"ns/a": {clusterKey: "ns/dev", profile: ProfileStatus{Name: "b", State: StateProvisioned}},
		"ns/b": {clusterKey: "ns/dev", profile: ProfileStatus{Name: "a", State: StateProvisioning}},
		"ns/c": {clusterKey: "ns/prod", profile: ProfileStatus{Name: "c", State: StateProvisioned}},
	}
	out := aggregate(summaries)
	if got := out["ns/dev"]; got.State != StateProvisioning || got.Profiles[0].Name != "a" {
		t.Errorf("unexpected dev status: %+v", got)
	}
	if got := out["ns/prod"]; got.State != StateProvisioned {
		t.Errorf("unexpected prod status: %+v", got)
	}
}
