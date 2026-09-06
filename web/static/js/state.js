// Global mutable state shared across all dashboard modules.

let ws;
let reconnectInterval = 5000;
let currentUser = null;
let userGroups = [];
let isAdmin = false;
let canCreate = false;
let isCreatorGroupMember = false;
let deleteClusterData = null;
let editClusterData = null;
let clusterParameters = [];
let allClusterParameters = []; // all parameters (unfiltered, for "More details" read-only)
let editableFields = {}; // key -> { enabled, min, max } from /api/cluster/editable
let workerGroupFields = []; // config-driven worker-group form schema from /api/cluster/worker-group-fields
let currentClustersList = [];

let editNodesData = null;
let createGroupIndex = 0;
let editGroupIndex = 0;
let editControlPlaneData = null;
let editVersionData = null;
let availableVersions = [];
let editParameterData = null;

// Tracks which "More details" panels are open so the expanded state
// survives full re-renders (the cluster list is rebuilt on every
// websocket/health-check update).
const expandedDetails = new Set();

// Parameters already surfaced elsewhere on the card (main details grid
// and groups section), excluded from "More details" to avoid duplicates.
const MORE_DETAILS_EXCLUDE = new Set([
    'podcidr', 'servicecidr', 'servicedomain',
    'version', 'nodes', 'controlplanereplicas', 'groups', 'name',
]);

// Tracks per-cluster kubeconfig generation status across re-renders.
// Keyed by "namespace/name". Each value: { type: 'pending'|'error', message }.
const kubeconfigStatus = {};

// Tracks the resolved default last applied to each parameter field, so a
// re-render (e.g. after the version changes) can tell whether the field
// still holds its default — and may be refreshed — or was edited by the
// user — and must be preserved.
const paramResolvedDefaults = {};

// Auto-refresh
let refreshInterval;
const REFRESH_INTERVAL = 30000; // 30 seconds

function clusterKey(name, namespace) {
    return `${namespace}/${name}`;
}

// clusterDomId builds the sanitized suffix used in per-cluster element
// IDs. It must match the idKey computed during card rendering so lookups
// resolve to the right element regardless of characters in the
// namespace/name.
function clusterDomId(namespace, name) {
    return `${namespace}-${name}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}
