package sveltos

import (
	"context"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"

	"github.com/Bealvio/chihiro/internal/capi"
)

// ClusterConfigurationResource is the plural resource name of the Sveltos
// ClusterConfiguration, which records what every profile actually deployed
// on one cluster.
const ClusterConfigurationResource = "clusterconfigurations"

// DeployedItem is one Helm release or Kubernetes resource a profile deployed
// on a cluster, as recorded in its ClusterConfiguration.
type DeployedItem struct {
	FeatureID string `json:"featureID"`
	// Kind is the resource kind, or "HelmChart" for Helm releases.
	Kind      string `json:"kind"`
	Group     string `json:"group,omitempty"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	// Version is the chart version for Helm releases, the API version
	// otherwise.
	Version         string     `json:"version,omitempty"`
	AppVersion      string     `json:"appVersion,omitempty"`
	RepoURL         string     `json:"repoURL,omitempty"`
	LastAppliedTime *time.Time `json:"lastAppliedTime,omitempty"`
}

// DeployedProfile groups what one ClusterProfile/Profile deployed.
type DeployedProfile struct {
	Kind  string         `json:"kind"`
	Name  string         `json:"name"`
	Items []DeployedItem `json:"items"`
}

// clusterConfigurationName mirrors Sveltos' naming: "<clustertype>--<name>",
// in the cluster's namespace.
func clusterConfigurationName(clusterName string) string {
	return "capi--" + clusterName
}

// FetchDeployed reads the ClusterConfiguration of a CAPI cluster and returns
// what each profile deployed on it. It is read on demand (cluster page only)
// rather than watched, since it can be large. Callers must have checked the
// user may see the cluster.
func FetchDeployed(ctx context.Context, client dynamic.Interface, resolver *capi.Resolver, namespace, clusterName string) ([]DeployedProfile, error) {
	gvr, err := resolver.GVRFor(Group, ClusterConfigurationResource, "")
	if err != nil {
		return nil, err
	}
	obj, err := client.Resource(gvr).Namespace(namespace).Get(ctx, clusterConfigurationName(clusterName), metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return parseClusterConfiguration(obj), nil
}

func parseClusterConfiguration(obj *unstructured.Unstructured) []DeployedProfile {
	status, _ := obj.Object["status"].(map[string]interface{})
	out := []DeployedProfile{}
	sections := []struct{ key, nameKey, kind string }{
		{"clusterProfileResources", "clusterProfileName", "ClusterProfile"},
		{"profileResources", "profileName", "Profile"},
	}
	for _, sec := range sections {
		for _, pr := range listOfMaps(status[sec.key]) {
			p := DeployedProfile{Kind: sec.kind, Items: []DeployedItem{}}
			p.Name, _ = pr[sec.nameKey].(string)
			// The field is capitalised in the Sveltos API ("Features").
			features := pr["Features"]
			if features == nil {
				features = pr["features"]
			}
			for _, f := range listOfMaps(features) {
				featureID, _ := f["featureID"].(string)
				for _, c := range listOfMaps(f["charts"]) {
					item := DeployedItem{FeatureID: featureID, Kind: "HelmChart"}
					item.Name, _ = c["releaseName"].(string)
					item.Namespace, _ = c["namespace"].(string)
					item.Version, _ = c["chartVersion"].(string)
					item.AppVersion, _ = c["appVersion"].(string)
					item.RepoURL, _ = c["repoURL"].(string)
					item.LastAppliedTime = parseTime(c["lastAppliedTime"])
					p.Items = append(p.Items, item)
				}
				for _, r := range listOfMaps(f["resources"]) {
					item := DeployedItem{FeatureID: featureID}
					item.Kind, _ = r["kind"].(string)
					item.Group, _ = r["group"].(string)
					item.Name, _ = r["name"].(string)
					item.Namespace, _ = r["namespace"].(string)
					item.Version, _ = r["version"].(string)
					item.LastAppliedTime = parseTime(r["lastAppliedTime"])
					p.Items = append(p.Items, item)
				}
			}
			sort.SliceStable(p.Items, func(i, j int) bool {
				a, b := p.Items[i], p.Items[j]
				if a.Kind != b.Kind {
					return a.Kind < b.Kind
				}
				if a.Namespace != b.Namespace {
					return a.Namespace < b.Namespace
				}
				return a.Name < b.Name
			})
			out = append(out, p)
		}
	}
	return out
}

func parseTime(v interface{}) *time.Time {
	ts, ok := v.(string)
	if !ok {
		return nil
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return nil
	}
	return &t
}
