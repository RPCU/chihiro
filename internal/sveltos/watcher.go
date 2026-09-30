// Package sveltos is an opt-in integration that surfaces Sveltos add-on
// deployment status next to each CAPI cluster in the dashboard.
//
// Sveltos (https://projectsveltos.github.io/sveltos/) records, for every
// (profile, cluster) pair it manages, a ClusterSummary in the cluster's
// namespace on the management cluster. Its status reports per-feature
// (Helm, Resources, Kustomize) deployment state and the Helm releases it
// manages. Chihiro only reads these objects; it never writes to Sveltos.
package sveltos

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"

	"github.com/Bealvio/chihiro/internal/capi"
)

const (
	// Group is the API group serving Sveltos ClusterSummaries.
	Group = "config.projectsveltos.io"
	// ClusterSummaryResource is the plural resource name of ClusterSummary.
	ClusterSummaryResource = "clustersummaries"

	// clusterTypeCAPI is the spec.clusterType value Sveltos uses for Cluster
	// API clusters. Summaries targeting SveltosClusters are ignored, since
	// chihiro only lists CAPI clusters.
	clusterTypeCAPI = "Capi"

	// Labels Sveltos sets on a ClusterSummary to name the owning profile.
	clusterProfileLabel = "projectsveltos.io/cluster-profile-name"
	profileLabel        = "projectsveltos.io/profile-name"

	// discoveryRetry bounds how often the watcher re-checks whether the
	// Sveltos CRDs are served, so installing Sveltos after chihiro starts is
	// picked up without a restart.
	discoveryRetry = 1 * time.Minute
	watchRetry     = 5 * time.Second
)

// Aggregated per-cluster states, ordered from best to worst so the overall
// state of a cluster is the worst state of any of its features.
const (
	StateProvisioned  = "Provisioned"
	StatePaused       = "Paused"
	StateProvisioning = "Provisioning"
	StateRemoving     = "Removing"
	StateFailed       = "Failed"
)

// FeatureStatus is the deployment state of one feature (Helm, Resources,
// Kustomize) of a profile on a cluster.
type FeatureStatus struct {
	FeatureID       string     `json:"featureID"`
	Status          string     `json:"status"`
	FailureMessage  string     `json:"failureMessage,omitempty"`
	LastAppliedTime *time.Time `json:"lastAppliedTime,omitempty"`
}

// Deployment is one item a profile deploys on a cluster: a Helm chart
// (spec.helmCharts), a referenced ConfigMap/Secret of resources
// (spec.policyRefs) or a Kustomize source (spec.kustomizationRefs).
type Deployment struct {
	// FeatureID is "Helm", "Resources" or "Kustomize".
	FeatureID string `json:"featureID"`
	// Kind is the referenced object kind (ConfigMap, Secret, GitRepository,
	// ...), or "HelmChart" for Helm releases.
	Kind string `json:"kind"`
	// Name and Namespace are the Helm release name/namespace, or the
	// referenced object's name/namespace.
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	// Source describes where it comes from: "<repo>/<chart>@<version>" for
	// Helm, the path for Kustomize.
	Source string `json:"source,omitempty"`
	// Status is the Sveltos FeatureStatus of the owning feature
	// (Provisioned, Provisioning, Failed, ...), or "Conflict" for a Helm
	// release already managed by another profile.
	Status          string     `json:"status"`
	Message         string     `json:"message,omitempty"`
	LastAppliedTime *time.Time `json:"lastAppliedTime,omitempty"`
}

// ProfileStatus links one ClusterProfile/Profile to the ClusterSummary
// Sveltos created for it on this cluster, and reports what it deploys.
type ProfileStatus struct {
	// Kind is "ClusterProfile" or "Profile".
	Kind string `json:"kind"`
	// Name is the ClusterProfile or Profile name.
	Name string `json:"name"`
	// Namespace is set for a (namespaced) Profile only.
	Namespace string `json:"namespace,omitempty"`
	// ClusterSummary is the name of the ClusterSummary linking the profile to
	// the cluster; it lives in the cluster's namespace.
	ClusterSummary string `json:"clusterSummary"`
	State          string `json:"state"`
	// FailureMessage reports errors reconciling the ClusterSummary itself,
	// as opposed to per-deployment errors.
	FailureMessage string `json:"failureMessage,omitempty"`
	Paused         bool   `json:"paused,omitempty"`
	// SelectorLabels are the cluster label keys the profile's clusterSelector
	// matches on. Chihiro parameters that write one of these labels are shown
	// as controlling the profile.
	SelectorLabels []string        `json:"selectorLabels,omitempty"`
	Features       []FeatureStatus `json:"features"`
	Deployments    []Deployment    `json:"deployments"`
}

// ClusterStatus is the aggregated Sveltos status of one cluster.
type ClusterStatus struct {
	// State is the worst State across Profiles, or empty when no profile
	// matches the cluster.
	State    string          `json:"state"`
	Profiles []ProfileStatus `json:"profiles"`
}

type summary struct {
	clusterKey string // "<namespace>/<name>" of the target CAPI cluster
	profile    ProfileStatus
}

// Watcher keeps an in-memory view of every ClusterSummary and reports the
// aggregated per-cluster status through an onChange callback.
type Watcher struct {
	client   dynamic.Interface
	resolver *capi.Resolver
	onChange func(map[string]*ClusterStatus)

	mu        sync.Mutex
	summaries map[string]summary // key: "<namespace>/<name>" of the ClusterSummary
}

// NewWatcher builds a watcher. onChange receives a fresh snapshot keyed by
// "<namespace>/<name>" of the CAPI cluster every time a ClusterSummary
// changes; it must not retain the map beyond replacing its own copy.
func NewWatcher(client dynamic.Interface, resolver *capi.Resolver, onChange func(map[string]*ClusterStatus)) *Watcher {
	return &Watcher{
		client:    client,
		resolver:  resolver,
		onChange:  onChange,
		summaries: make(map[string]summary),
	}
}

// ClusterKey builds the key used in the snapshot passed to onChange.
func ClusterKey(namespace, name string) string {
	return namespace + "/" + name
}

// Start runs the watch loop until ctx is cancelled.
func (w *Watcher) Start(ctx context.Context) {
	go w.run(ctx)
}

func (w *Watcher) run(ctx context.Context) {
	gvr, ok := w.waitForCRD(ctx)
	if !ok {
		return
	}

	for {
		if ctx.Err() != nil {
			return
		}
		resourceVersion, err := w.relist(ctx, gvr)
		if err != nil {
			slog.Error("Failed to list Sveltos ClusterSummaries", "error", err)
			if !sleepCtx(ctx, watchRetry) {
				return
			}
			continue
		}
		w.watch(ctx, gvr, resourceVersion)
		if !sleepCtx(ctx, watchRetry) {
			return
		}
	}
}

// waitForCRD resolves the ClusterSummary GVR, retrying until Sveltos is
// installed. No fallback version is passed to the resolver on purpose: a
// missing CRD must not be mistaken for a served one.
func (w *Watcher) waitForCRD(ctx context.Context) (schema.GroupVersionResource, bool) {
	warned := false
	for {
		gvr, err := w.resolver.GVRFor(Group, ClusterSummaryResource, "")
		if err == nil {
			slog.Info("Sveltos integration enabled", "gvr", gvr.String())
			return gvr, true
		}
		if !warned {
			slog.Warn("Sveltos integration enabled but ClusterSummary CRD not found, retrying", "error", err, "retry", discoveryRetry)
			warned = true
		}
		if !sleepCtx(ctx, discoveryRetry) {
			return schema.GroupVersionResource{}, false
		}
		// Discovery results are cached; drop them so a freshly installed
		// CRD is seen on the next attempt.
		w.resolver.Invalidate()
	}
}

// relist replaces the cache with a full list and returns its resourceVersion
// so the following watch starts exactly where the list ended.
func (w *Watcher) relist(ctx context.Context, gvr schema.GroupVersionResource) (string, error) {
	list, err := w.client.Resource(gvr).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}

	summaries := make(map[string]summary, len(list.Items))
	for i := range list.Items {
		if s, ok := parseClusterSummary(&list.Items[i]); ok {
			summaries[objectKey(&list.Items[i])] = s
		}
	}
	slog.Info("Loaded Sveltos ClusterSummaries", "count", len(summaries))

	w.mu.Lock()
	w.summaries = summaries
	w.mu.Unlock()
	w.notify()

	return list.GetResourceVersion(), nil
}

func (w *Watcher) watch(ctx context.Context, gvr schema.GroupVersionResource, resourceVersion string) {
	watcher, err := w.client.Resource(gvr).Watch(ctx, metav1.ListOptions{ResourceVersion: resourceVersion})
	if err != nil {
		slog.Error("Failed to watch Sveltos ClusterSummaries", "error", err)
		return
	}
	defer watcher.Stop()

	for event := range watcher.ResultChan() {
		if event.Type == watch.Error {
			slog.Warn("Sveltos ClusterSummary watch error, relisting", "object", event.Object)
			return
		}
		obj, ok := event.Object.(*unstructured.Unstructured)
		if !ok {
			continue
		}

		key := objectKey(obj)
		w.mu.Lock()
		switch event.Type {
		case watch.Added, watch.Modified:
			if s, ok := parseClusterSummary(obj); ok {
				w.summaries[key] = s
			} else {
				delete(w.summaries, key)
			}
		case watch.Deleted:
			delete(w.summaries, key)
		}
		w.mu.Unlock()
		w.notify()
	}
}

func (w *Watcher) notify() {
	w.mu.Lock()
	snapshot := aggregate(w.summaries)
	w.mu.Unlock()
	w.onChange(snapshot)
}

// aggregate groups summaries by target cluster and computes each cluster's
// overall state. Profiles are sorted by name for a stable UI.
func aggregate(summaries map[string]summary) map[string]*ClusterStatus {
	out := make(map[string]*ClusterStatus)
	for _, s := range summaries {
		cs, ok := out[s.clusterKey]
		if !ok {
			cs = &ClusterStatus{}
			out[s.clusterKey] = cs
		}
		cs.Profiles = append(cs.Profiles, s.profile)
	}
	for _, cs := range out {
		sort.Slice(cs.Profiles, func(i, j int) bool {
			if cs.Profiles[i].Name != cs.Profiles[j].Name {
				return cs.Profiles[i].Name < cs.Profiles[j].Name
			}
			return cs.Profiles[i].Kind < cs.Profiles[j].Kind
		})
		for _, p := range cs.Profiles {
			cs.State = worseState(cs.State, p.State)
		}
	}
	return out
}

func objectKey(obj *unstructured.Unstructured) string {
	return obj.GetNamespace() + "/" + obj.GetName()
}

// parseClusterSummary extracts the fields chihiro displays. It returns false
// for summaries that don't target a CAPI cluster.
func parseClusterSummary(obj *unstructured.Unstructured) (summary, bool) {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	status, _ := obj.Object["status"].(map[string]interface{})

	clusterType, _ := spec["clusterType"].(string)
	if clusterType != clusterTypeCAPI {
		return summary{}, false
	}
	clusterName, _ := spec["clusterName"].(string)
	clusterNamespace, _ := spec["clusterNamespace"].(string)
	if clusterName == "" {
		return summary{}, false
	}
	if clusterNamespace == "" {
		clusterNamespace = obj.GetNamespace()
	}

	profile := ProfileStatus{
		ClusterSummary: obj.GetName(),
		Features:       []FeatureStatus{},
		Deployments:    []Deployment{},
	}
	labels := obj.GetLabels()
	switch {
	case labels[clusterProfileLabel] != "":
		profile.Kind, profile.Name = "ClusterProfile", labels[clusterProfileLabel]
	case labels[profileLabel] != "":
		profile.Kind, profile.Name = "Profile", labels[profileLabel]
	default:
		// Fall back to the owner reference, then to the summary name.
		profile.Name = obj.GetName()
		for _, ref := range obj.GetOwnerReferences() {
			if ref.Kind == "ClusterProfile" || ref.Kind == "Profile" {
				profile.Kind, profile.Name = ref.Kind, ref.Name
				break
			}
		}
	}
	// A Profile only matches clusters in its own namespace, which is also
	// where its ClusterSummaries live.
	if profile.Kind == "Profile" {
		profile.Namespace = obj.GetNamespace()
	}

	features := make(map[string]FeatureStatus)
	if items, ok := status["featureSummaries"].([]interface{}); ok {
		for _, f := range items {
			fm, ok := f.(map[string]interface{})
			if !ok {
				continue
			}
			fs := FeatureStatus{}
			fs.FeatureID, _ = fm["featureID"].(string)
			fs.Status, _ = fm["status"].(string)
			fs.FailureMessage, _ = fm["failureMessage"].(string)
			if ts, ok := fm["lastAppliedTime"].(string); ok {
				if t, err := time.Parse(time.RFC3339, ts); err == nil {
					fs.LastAppliedTime = &t
				}
			}
			profile.Features = append(profile.Features, fs)
			features[fs.FeatureID] = fs
		}
	}
	sort.Slice(profile.Features, func(i, j int) bool { return profile.Features[i].FeatureID < profile.Features[j].FeatureID })

	profileSpec, _ := spec["clusterProfileSpec"].(map[string]interface{})
	profile.Deployments = parseDeployments(profileSpec, status, features)
	profile.SelectorLabels = selectorLabelKeys(profileSpec["clusterSelector"])
	profile.FailureMessage, _ = status["failureMessage"].(string)
	profile.Paused, _ = status["reconciliationSuspended"].(bool)
	profile.State = profileState(&profile, obj.GetDeletionTimestamp() != nil)

	return summary{clusterKey: ClusterKey(clusterNamespace, clusterName), profile: profile}, true
}

// parseDeployments lists what the profile deploys (from the copy of the
// profile spec embedded in the ClusterSummary) and gives each item the status
// of its feature. Helm releases additionally carry their per-release conflict
// or failure from status.helmReleaseSummaries.
func parseDeployments(profileSpec, status map[string]interface{}, features map[string]FeatureStatus) []Deployment {
	deployments := []Deployment{}

	type release struct{ status, message string }
	releases := make(map[string]release)
	if items, ok := status["helmReleaseSummaries"].([]interface{}); ok {
		for _, r := range items {
			rm, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := rm["releaseName"].(string)
			ns, _ := rm["releaseNamespace"].(string)
			st, _ := rm["status"].(string)
			msg, _ := rm["conflictMessage"].(string)
			if fm, ok := rm["failureMessage"].(string); ok && fm != "" {
				msg = fm
			}
			releases[ns+"/"+name] = release{status: st, message: msg}
		}
	}

	withFeature := func(d Deployment) Deployment {
		f, ok := features[d.FeatureID]
		if !ok {
			// No status yet for this feature: the controller hasn't
			// reconciled it.
			d.Status = "Provisioning"
			return d
		}
		d.Status = f.Status
		d.LastAppliedTime = f.LastAppliedTime
		if featureState(f.Status) == StateFailed {
			d.Message = f.FailureMessage
		}
		return d
	}

	for _, item := range listOfMaps(profileSpec["helmCharts"]) {
		d := Deployment{FeatureID: "Helm", Kind: "HelmChart"}
		d.Name, _ = item["releaseName"].(string)
		d.Namespace, _ = item["releaseNamespace"].(string)
		chart, _ := item["chartName"].(string)
		version, _ := item["chartVersion"].(string)
		d.Source = chart
		if version != "" {
			d.Source += "@" + version
		}
		d = withFeature(d)
		if r, ok := releases[d.Namespace+"/"+d.Name]; ok {
			if r.status == "Conflict" {
				d.Status = "Conflict"
			}
			if r.message != "" {
				d.Message = r.message
			}
		}
		deployments = append(deployments, d)
	}

	refs := []struct{ key, featureID string }{
		{"policyRefs", "Resources"},
		{"kustomizationRefs", "Kustomize"},
	}
	for _, ref := range refs {
		for _, item := range listOfMaps(profileSpec[ref.key]) {
			d := Deployment{FeatureID: ref.featureID}
			d.Kind, _ = item["kind"].(string)
			d.Name, _ = item["name"].(string)
			d.Namespace, _ = item["namespace"].(string)
			d.Source, _ = item["path"].(string)
			deployments = append(deployments, withFeature(d))
		}
	}

	return deployments
}

// selectorLabelKeys returns the sorted label keys a clusterSelector uses.
// v1beta1 profiles embed a LabelSelector (matchLabels/matchExpressions);
// older ones use a "key=value,..." selector string.
func selectorLabelKeys(v interface{}) []string {
	keys := make(map[string]struct{})
	switch sel := v.(type) {
	case string:
		if parsed, err := labels.Parse(sel); err == nil {
			reqs, _ := parsed.Requirements()
			for _, r := range reqs {
				keys[r.Key()] = struct{}{}
			}
		}
	case map[string]interface{}:
		if ml, ok := sel["matchLabels"].(map[string]interface{}); ok {
			for k := range ml {
				keys[k] = struct{}{}
			}
		}
		for _, expr := range listOfMaps(sel["matchExpressions"]) {
			if k, ok := expr["key"].(string); ok && k != "" {
				keys[k] = struct{}{}
			}
		}
	}
	if len(keys) == 0 {
		return nil
	}
	out := make([]string, 0, len(keys))
	for k := range keys {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func listOfMaps(v interface{}) []map[string]interface{} {
	items, _ := v.([]interface{})
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

// profileState folds a summary's status into a single state. Errors win over
// everything else; a summary with no feature status yet has just been created
// and is still provisioning.
func profileState(p *ProfileStatus, deleting bool) string {
	state := StateProvisioned
	if len(p.Features) == 0 {
		state = StateProvisioning
	}
	for _, f := range p.Features {
		state = worseState(state, featureState(f.Status))
	}
	if deleting {
		state = worseState(state, StateRemoving)
	}
	if p.Paused {
		state = worseState(state, StatePaused)
	}
	if p.FailureMessage != "" {
		state = StateFailed
	}
	for _, d := range p.Deployments {
		if d.Status == "Conflict" {
			state = StateFailed
		}
	}
	return state
}

// featureState maps a Sveltos FeatureStatus onto chihiro's aggregated states.
func featureState(status string) string {
	switch status {
	case "Provisioned":
		return StateProvisioned
	case "Failed", "FailedNonRetriable":
		return StateFailed
	case "Removing", "AgentRemoving", "Removed":
		return StateRemoving
	default: // Provisioning, Blocked, or empty while the controller catches up
		return StateProvisioning
	}
}

var stateRank = map[string]int{
	"":                0,
	StateProvisioned:  1,
	StatePaused:       2,
	StateProvisioning: 3,
	StateRemoving:     4,
	StateFailed:       5,
}

func worseState(a, b string) string {
	if stateRank[b] > stateRank[a] {
		return b
	}
	return a
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
