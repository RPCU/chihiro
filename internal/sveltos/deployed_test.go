package sveltos

import (
	"reflect"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestParseClusterSummaryProfileSettings(t *testing.T) {
	obj := clusterSummary("addons-capi-dev-1",
		map[string]interface{}{clusterProfileLabel: "addons"},
		capiSpec(map[string]interface{}{
			"syncMode":  "ContinuousWithDriftDetection",
			"tier":      int64(50),
			"dependsOn": []interface{}{"cni"},
			"helmCharts": []interface{}{
				map[string]interface{}{
					"releaseName": "cilium", "releaseNamespace": "kube-system", "chartName": "cilium/cilium",
					"chartVersion": "1.16.0", "repositoryURL": "https://helm.cilium.io",
				},
				map[string]interface{}{"releaseName": "old", "releaseNamespace": "kube-system", "chartName": "x/old", "helmChartAction": "Uninstall"},
			},
		}),
		map[string]interface{}{
			"dependencies": "cni not deployed yet",
			"featureSummaries": []interface{}{
				map[string]interface{}{"featureID": "Helm", "status": "Failed", "consecutiveFailures": int64(3), "failureMessage": "boom"},
			},
			"deployedGVKs": []interface{}{
				map[string]interface{}{"featureID": "Helm", "deployedGroupVersionKind": []interface{}{"Deployment.v1.apps", "Service.v1."}},
			},
			"helmReleaseSummaries": []interface{}{
				map[string]interface{}{"releaseName": "cilium", "releaseNamespace": "kube-system", "status": "Managing", "latestVersion": "1.17.0"},
			},
		},
	)

	s, ok := parseClusterSummary(obj)
	if !ok {
		t.Fatal("expected CAPI summary to be parsed")
	}
	p := s.profile
	if p.SyncMode != "ContinuousWithDriftDetection" || p.Tier != 50 || !reflect.DeepEqual(p.DependsOn, []string{"cni"}) {
		t.Errorf("settings = %q %d %v", p.SyncMode, p.Tier, p.DependsOn)
	}
	if p.Dependencies != "cni not deployed yet" {
		t.Errorf("dependencies = %q", p.Dependencies)
	}
	if len(p.Features) != 1 || p.Features[0].ConsecutiveFailures != 3 {
		t.Fatalf("features = %+v", p.Features)
	}
	if !reflect.DeepEqual(p.Features[0].DeployedKinds, []string{"Deployment.v1.apps", "Service.v1."}) {
		t.Errorf("deployedKinds = %v", p.Features[0].DeployedKinds)
	}
	cilium, old := p.Deployments[0], p.Deployments[1]
	if cilium.RepoURL != "https://helm.cilium.io" || cilium.LatestVersion != "1.17.0" || cilium.Uninstall {
		t.Errorf("cilium = %+v", cilium)
	}
	if !old.Uninstall {
		t.Errorf("expected uninstall action on %+v", old)
	}
}

func TestParseClusterConfiguration(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{"name": "capi--dev-1", "namespace": "capi-system"},
		"status": map[string]interface{}{
			"clusterProfileResources": []interface{}{
				map[string]interface{}{
					"clusterProfileName": "addons",
					"Features": []interface{}{
						map[string]interface{}{
							"featureID": "Helm",
							"charts": []interface{}{
								map[string]interface{}{
									"releaseName": "cilium", "namespace": "kube-system", "chartVersion": "1.16.0",
									"appVersion": "1.16.0", "repoURL": "https://helm.cilium.io", "lastAppliedTime": "2026-09-01T10:00:00Z",
								},
							},
						},
						map[string]interface{}{
							"featureID": "Resources",
							"resources": []interface{}{
								map[string]interface{}{"kind": "Namespace", "group": "", "version": "v1", "name": "team-a"},
								map[string]interface{}{"kind": "ConfigMap", "group": "", "version": "v1", "name": "cfg", "namespace": "team-a"},
							},
						},
					},
				},
			},
			"profileResources": []interface{}{
				map[string]interface{}{"profileName": "local"},
			},
		},
	}}

	got := parseClusterConfiguration(obj)
	if len(got) != 2 {
		t.Fatalf("profiles = %+v", got)
	}
	if got[0].Kind != "ClusterProfile" || got[0].Name != "addons" || len(got[0].Items) != 3 {
		t.Fatalf("first profile = %+v", got[0])
	}
	kinds := []string{got[0].Items[0].Kind, got[0].Items[1].Kind, got[0].Items[2].Kind}
	if !reflect.DeepEqual(kinds, []string{"ConfigMap", "HelmChart", "Namespace"}) {
		t.Errorf("items not sorted by kind: %v", kinds)
	}
	chart := got[0].Items[1]
	if chart.RepoURL != "https://helm.cilium.io" || chart.AppVersion != "1.16.0" || chart.LastAppliedTime == nil {
		t.Errorf("chart = %+v", chart)
	}
	if got[1].Kind != "Profile" || got[1].Name != "local" || len(got[1].Items) != 0 {
		t.Errorf("second profile = %+v", got[1])
	}
}
