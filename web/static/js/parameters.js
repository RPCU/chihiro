// Dynamic parameter rendering, constraints, and version-dependent logic.

// versionDependentParams returns the declared parameters that will be
// recomputed when the version changes. This includes parameters with
// explicit recompute_on "version" as well as select parameters whose
// options constrain the version field (auto-detected dependency).
function versionDependentParams() {
    return (clusterParameters || []).filter(p => {
        // Explicit recompute_on dependency.
        if (Array.isArray(p.recomputeOn) &&
            p.recomputeOn.some(d => String(d).toLowerCase() === 'version')) {
            return true;
        }
        // Auto-detected: select with options constraining version.
        if (p.type === 'select' && Array.isArray(p.options) &&
            p.options.some(o => optionConstraintValues(o, 'version') !== null)) {
            return true;
        }
        return false;
    });
}

// computeDependentValueForVersion mirrors the server's recompute logic
// for a single parameter and target version: pick the option compatible
// with the new version (honoring each option's versions list), keeping
// the current option when it stays compatible, then resolve the embedded
// chihiro version token. Returns the final resolved value.
function computeDependentValueForVersion(p, newVersion, cluster) {
    const tokens = { version: newVersion };
    // Current raw state from the cluster's stored parameters (if any).
    let current;
    if (cluster && cluster.parameters) {
        const k = Object.keys(cluster.parameters).find(
            x => x.toLowerCase() === p.key.toLowerCase());
        if (k !== undefined) current = cluster.parameters[k];
    }

    const opts = (p.type === 'select' && Array.isArray(p.options)) ? p.options : [];
    const compatible = (o) => {
        const allowed = optionConstraintValues(o, 'version');
        return !allowed ||
            allowed.some(v => String(v).toLowerCase() === String(newVersion).toLowerCase());
    };

    let candidate;
    if (opts.length > 0) {
        // Keep current option if still compatible.
        if (current) {
            const match = opts.find(o =>
                (o.value === current ||
                 resolveChihiroTokens(o.value, tokens) === resolveChihiroTokens(current, tokens))
                && compatible(o));
            if (match) candidate = match.value;
        }
        // Otherwise first compatible option.
        if (candidate === undefined) {
            const firstCompat = opts.find(compatible);
            if (firstCompat) candidate = firstCompat.value;
        }
        if (candidate === undefined) candidate = current || p.default;
    } else {
        candidate = current || p.default;
    }

    return resolveChihiroTokens(candidate, tokens);
}

// renderVersionDependents shows, for the selected target version, what
// each version-dependent parameter (e.g. the node image) will be changed
// to. Pass an empty version to hide the preview.
function renderVersionDependents(newVersion) {
    const container = document.getElementById('editVersionDependents');
    const deps = versionDependentParams();
    if (!newVersion || deps.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    const cluster = editVersionData && editVersionData.cluster;
    const rows = deps.map(p => {
        const resolved = computeDependentValueForVersion(p, newVersion, cluster);
        return `
            <div class="detail-item">
                <div class="detail-label">${escapeHtml(p.label || parameterLabel(p.key))}</div>
                <div class="detail-value">${escapeHtml(resolved || '')}</div>
            </div>`;
    }).join('');
    container.innerHTML = `
        <div class="detail-label" style="margin-bottom: 8px;">Will also be updated</div>
        ${rows}
        <small style="color: var(--md-sys-color-on-surface-variant); font-size: 0.8rem; display: block; margin-top: 4px;">
            These values are recomputed automatically to stay compatible with the selected version.
        </small>`;
    container.style.display = 'block';
}

// Generic editable-parameter modal.

function openEditParameterModal(name, namespace, key) {
    const cluster = currentClustersList.find(c => c.name === name && c.namespace === namespace);
    const meta = (allClusterParameters || []).find(p => p.key && p.key.toLowerCase() === key.toLowerCase());
    const editMeta = editableFields[key.toLowerCase()] || {};
    const type = (meta && meta.type) || editMeta.type || 'string';
    // Resolve the current value. The chihiro.io/parameters annotation is
    // the source of truth, but boolean toggles whose value lives in a
    // cluster label (e.g. the Sveltos addon labels for declared params)
    // are not recorded there until first edited. Fall back to reading
    // the live label value via the param's path so the control reflects
    // the cluster's actual state instead of the static default.
    let current;
    const annotationKey = (cluster && cluster.parameters)
        ? Object.keys(cluster.parameters).find(k => k.toLowerCase() === key.toLowerCase())
        : undefined;
    if (annotationKey !== undefined) {
        current = cluster.parameters[annotationKey];
    } else {
        const labelVal = (meta && meta.path && cluster)
            ? extractLabelValue(meta.path, cluster.labels) : undefined;
        current = (labelVal !== undefined) ? String(labelVal) : (meta ? meta.default : '');
    }

    editParameterData = { name, namespace, key, type };

    document.getElementById('editParameterTitle').textContent =
        'Edit ' + ((meta && meta.label) || parameterLabel(key));
    document.getElementById('editParameterClusterName').textContent = name;
    document.getElementById('editParameterDescription').textContent =
        (meta && meta.description) || '';

    const field = document.getElementById('editParameterField');
    field.innerHTML = '';

    if (type === 'boolean') {
        const on = (current === 'true' || (meta && current === meta.trueValue));
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'editParameterInput';
        cb.style.width = 'auto';
        cb.checked = on;
        label.appendChild(cb);
        label.appendChild(document.createTextNode((meta && meta.label) || parameterLabel(key)));
        field.appendChild(label);
    } else if (type === 'select' && meta && meta.options && meta.options.length > 0) {
        const sel = document.createElement('select');
        sel.id = 'editParameterInput';
        meta.options.forEach(opt => {
            // Options may be plain strings or {value,label,constrain}
            // objects (constrained selects like the node image).
            const value = (opt && typeof opt === 'object') ? opt.value : opt;
            const label = (opt && typeof opt === 'object') ? (opt.label || opt.value) : opt;
            const o = document.createElement('option');
            o.value = value; o.textContent = label;
            if (value === current) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = function() { renderParameterImpliedFields(); };
        field.appendChild(sel);
    } else {
        const input = document.createElement('input');
        input.type = type === 'number' ? 'number' : 'text';
        input.id = 'editParameterInput';
        input.value = current || '';
        field.appendChild(input);
    }

    document.getElementById('editParameterModalOverlay').style.display = 'flex';
    if (meta && meta.type === 'select' && Array.isArray(meta.options) &&
        meta.options.some(o => o && typeof o === 'object' && o.constrain &&
            Object.keys(o.constrain).length > 0)) {
        renderParameterImpliedFields();
    }
}

function closeEditParameterModal() {
    document.getElementById('editParameterModalOverlay').style.display = 'none';
    document.getElementById('editParameterImplied').style.display = 'none';
    editParameterData = null;
}

// renderParameterImpliedFields shows, for the selected parameter value,
// what other fields will be auto-set. For select parameters with
// constrained options, selecting an option that pins a field to a single
// value implies that value for the field.
function renderParameterImpliedFields() {
    const container = document.getElementById('editParameterImplied');
    if (!editParameterData || !editParameterData.key) {
        container.style.display = 'none';
        return;
    }
    const meta = (allClusterParameters || []).find(
        p => p.key && p.key.toLowerCase() === editParameterData.key.toLowerCase());
    if (!meta || meta.type !== 'select' || !Array.isArray(meta.options)) {
        container.style.display = 'none';
        return;
    }

    // Auto-detect: does this parameter have constrained options?
    const hasConstraints = meta.options.some(o =>
        o && typeof o === 'object' && o.constrain &&
        Object.keys(o.constrain).length > 0);
    if (!hasConstraints) {
        container.style.display = 'none';
        return;
    }

    const input = document.getElementById('editParameterInput');
    const rawValue = input.value;

    const match = meta.options.find(o => {
        const v = (o && typeof o === 'object') ? o.value : o;
        return v === rawValue;
    });
    if (!match || !match.constrain) {
        container.style.display = 'none';
        return;
    }

    // Any field the selected option pins to exactly one value is implied.
    const implied = Object.entries(match.constrain)
        .filter(([, vals]) => Array.isArray(vals) && vals.length === 1)
        .map(([field, vals]) => {
            const label = (editableFields && editableFields[field])
                ? (editableFields[field].label || field)
                : parameterLabel(field);
            return `
                <div class="detail-item">
                    <div class="detail-label">${escapeHtml(label)}</div>
                    <div class="detail-value">${escapeHtml(vals[0])}</div>
                </div>`;
        });
    if (implied.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.innerHTML = `
        <div class="detail-label" style="margin-bottom: 8px;">Will also be updated</div>
        ${implied.join('')}
        <small style="color: var(--md-sys-color-on-surface-variant); font-size: 0.8rem; display: block; margin-top: 4px;">
            These values are set automatically to stay consistent with the selected option.
        </small>`;
    container.style.display = 'block';
}

// filterImageDropdown greys out image options whose version constraint
// does not include the currently selected Kubernetes version. Pass null
// to enable all options. Auto-selects the first compatible image if the
// current selection is no longer compatible.
function filterImageDropdown(compatibleVersions) {
    // Find all selects that have version metadata.
    document.querySelectorAll('select[data-has-versions]').forEach(sel => {
        const versionMap = sel._resolvedVersionMap || {};
        let foundCompatible = false;
        Array.from(sel.options).forEach(opt => {
            if (!opt.value) return; // skip placeholder
            const optVersions = versionMap[opt.value];
            const isCompatible = !compatibleVersions || !optVersions || optVersions.some(v => compatibleVersions.includes(v));
            opt.disabled = !isCompatible;
            opt.style.color = isCompatible ? '' : 'var(--md-sys-color-on-surface-variant)';
            opt.style.opacity = isCompatible ? '' : '0.5';
            if (opt.value === sel.value && isCompatible) foundCompatible = true;
        });
        // Auto-select first compatible option if current is no longer valid.
        if (!foundCompatible) {
            const firstCompatible = Array.from(sel.options).find(o => o.value && !o.disabled);
            if (firstCompatible) {
                sel.value = firstCompatible.value;
                sel.dispatchEvent(new Event('change'));
            }
        }
    });
}

// applyParameterConstraints filters constrained selects: disables
// options whose `constrain` on any current field value isn't satisfied
// and auto-selects the first compatible option. Reads each constraining
// field's live value from its param_<field> control (or built-in
// clusterName/clusterVersion controls).
function applyParameterConstraints() {
    // Constraint field names are lowercased but control IDs use
    // original casing — recover it for the lookup.
    const casing = {};
    (clusterParameters || []).forEach(p => { if (p && p.key) casing[p.key.toLowerCase()] = p.key; });
    const fieldValue = (field) => {
        // Built-in fields live in dedicated controls, not param_<field>.
        if (field === 'name') {
            const el = document.getElementById('clusterName');
            return el ? el.value : undefined;
        }
        if (field === 'version') {
            const el = document.getElementById('clusterVersion');
            return el ? el.value : undefined;
        }
        const realKey = casing[field] || field;
        const el = document.getElementById('param_' + realKey);
        if (!el) return undefined;
        return el.type === 'checkbox' ? String(el.checked) : el.value;
    };
    const selects = document.querySelectorAll('select[data-constrained]');
    // One pass evaluates selects in DOM order, so a select constrained by
    // a later one would read a stale value. Re-run until no select
    // changes (fixpoint), bounded so a cyclic constrain config can't spin.
    for (let pass = 0; pass < selects.length + 1; pass++) {
        let changed = false;
        selects.forEach(sel => {
            const constraintMap = sel._constraintMap || {};
            let foundCompatible = false;
            Array.from(sel.options).forEach(opt => {
                if (!opt.value) return; // skip placeholder
                const perField = constraintMap[opt.value];
                let isCompatible = true;
                if (perField) {
                    for (const field in perField) {
                        const allowed = perField[field];
                        const cur = fieldValue(field);
                        if (cur === undefined || cur === '') { isCompatible = false; break; }
                        if (!allowed.some(v => v.toLowerCase() === String(cur).toLowerCase())) {
                            isCompatible = false;
                            break;
                        }
                    }
                }
                opt.disabled = !isCompatible;
                opt.style.color = isCompatible ? '' : 'var(--md-sys-color-on-surface-variant)';
                opt.style.opacity = isCompatible ? '' : '0.5';
                if (opt.value === sel.value && isCompatible) foundCompatible = true;
            });
            if (!foundCompatible) {
                const firstCompatible = Array.from(sel.options).find(o => o.value && !o.disabled);
                if (firstCompatible && sel.value !== firstCompatible.value) {
                    sel.value = firstCompatible.value;
                    changed = true;
                }
            }
        });
        if (!changed) break;
    }
}

function renderDynamicParameters() {
    const container = document.getElementById('dynamicParamsContainer');
    if (!clusterParameters || clusterParameters.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Snapshot current field values before rebuilding so user input is
    // not lost. Re-rendering is needed because version-derived defaults
    // (e.g. an image name containing a chihiro.version placeholder) must
    // refresh when the selected version changes.
    const previousValues = {};
    clusterParameters.forEach(p => {
        const el = document.getElementById('param_' + p.key);
        if (el) previousValues[p.key] = (el.type === 'checkbox') ? String(el.checked) : el.value;
    });

    container.innerHTML = '';

    const builtins = {
        version: document.getElementById('clusterVersion').value || '',
        name: (document.getElementById('clusterName') || {}).value || '',
    };

    clusterParameters.forEach(p => {
        const group = document.createElement('div');
        group.className = 'form-group';

        const label = document.createElement('label');
        label.setAttribute('for', 'param_' + p.key);
        label.textContent = p.label + (p.required ? ' *' : '');
        group.appendChild(label);

        const resolvedDefault = resolveParameterValue(p.default, builtins);

        // Decide the value to show: keep the user's edit, but if the
        // field still matched its previously-resolved default (i.e. it
        // was untouched), refresh it to the new resolved default so
        // version-derived values stay in sync.
        const hadPrevious = Object.prototype.hasOwnProperty.call(previousValues, p.key);
        const previousValue = hadPrevious ? previousValues[p.key] : undefined;
        const previousDefault = paramResolvedDefaults[p.key];
        const isAutoResolved = p.default && /\{\{\s*chihiro\.\w+\s*\}\}/.test(p.default);
        let valueToApply;
        if (!hadPrevious || isAutoResolved) {
            valueToApply = resolvedDefault;
        } else if (previousValue === '' || previousValue === previousDefault) {
            valueToApply = resolvedDefault;
        } else {
            valueToApply = previousValue;
        }
        paramResolvedDefaults[p.key] = resolvedDefault;

        let input;
        if (p.type === 'boolean') {
            // Render a checkbox; the value collected is "true"/"false".
            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = 'param_' + p.key;
            input.style.width = 'auto';
            input.style.marginRight = '8px';
            // valueToApply is "true"/"false" (string).
            const isOn = (valueToApply === undefined || valueToApply === '')
                ? (p.default === 'true')
                : (valueToApply === 'true' || valueToApply === true);
            input.checked = isOn;
            // Put the checkbox before the label text for a natural layout.
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.insertBefore(input, label.firstChild);
        } else if (p.type === 'select' || (isAutoResolved && p.options && p.options.length > 0)) {
            input = document.createElement('select');
            input.id = 'param_' + p.key;
            if (!p.required) {
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'Select...';
                input.appendChild(emptyOpt);
            }
            // Store full option metadata for version filtering.
            input._optionMeta = p.options || [];
            p.options.forEach(opt => {
                const optValue = (typeof opt === 'object' && opt !== null) ? opt.value : opt;
                const optLabel = (typeof opt === 'object' && opt !== null) ? (opt.label || opt.value) : opt;
                const resolved = isAutoResolved ? resolveParameterValue(optValue, builtins) : optValue;
                const resolvedLabel = isAutoResolved ? resolveParameterValue(optLabel, builtins) : optLabel;
                const option = document.createElement('option');
                option.value = resolved;
                option.textContent = resolvedLabel;
                if (resolved === valueToApply) option.selected = true;
                input.appendChild(option);
            });
            // When a select has options constraining the version field,
            // store a resolved-value→allowed-versions lookup for
            // version-based filtering of the create form.
            const hasVersions = p.options.some(o => optionConstraintValues(o, 'version') !== null);
            if (hasVersions) {
                input.setAttribute('data-has-versions', 'true');
                const resolvedVersionMap = {};
                p.options.forEach(opt => {
                    const allowed = optionConstraintValues(opt, 'version');
                    if (allowed) {
                        const rv = resolveParameterValue(opt.value, builtins);
                        resolvedVersionMap[rv] = allowed;
                    }
                });
                input._resolvedVersionMap = resolvedVersionMap;
            }
            // Generic constraints: an option may constrain any other
            // field. Build an optionValue → {field → allowedValues}
            // lookup. Version is handled above and excluded here.
            const constrainFields = new Set();
            p.options.forEach(opt => {
                if (opt && typeof opt === 'object' && opt.constrain) {
                    Object.keys(opt.constrain).forEach(f => {
                        if (f.toLowerCase() !== 'version') constrainFields.add(f.toLowerCase());
                    });
                }
            });
            if (constrainFields.size > 0) {
                input.setAttribute('data-constrained', 'true');
                const constraintMap = {};
                p.options.forEach(opt => {
                    if (!opt || typeof opt !== 'object' || !opt.constrain) return;
                    // Key must match the DOM option value exactly, which
                    // is only resolved when the parameter is auto-resolved.
                    const key = isAutoResolved
                        ? resolveParameterValue(opt.value, builtins)
                        : opt.value;
                    const perField = {};
                    constrainFields.forEach(f => {
                        const allowed = optionConstraintValues(opt, f);
                        if (allowed) perField[f] = allowed.map(v => String(v));
                    });
                    constraintMap[key] = perField;
                });
                input._constraintMap = constraintMap;
            }
        } else {
            input = document.createElement('input');
            input.type = p.type === 'number' ? 'number' : 'text';
            input.id = 'param_' + p.key;
            input.placeholder = resolvedDefault || '';
            if (valueToApply) input.value = valueToApply;
            if (p.type === 'number') input.min = '0';
        }
        if (p.required && p.type !== 'boolean') input.required = true;
        // Auto-resolved params (defaults containing chihiro variable refs) always
        // resolve the variable part; the user can still edit the non-variable
        // prefix/suffix but the variable is never removable.
        if (isAutoResolved && p.type !== 'boolean' && input.tagName !== 'SELECT') {
            input.placeholder = p.default;
            input.value = resolvedDefault;
            input.style.fontStyle = 'italic';
            input.style.color = 'var(--md-sys-color-on-surface-variant)';
        }
        // Booleans were already placed inside the label above.
        if (p.type !== 'boolean') {
            group.appendChild(input);
        }

        // Re-run generic constraint filter when any control changes.
        input.addEventListener('change', applyParameterConstraints);

        if (p.description) {
            const small = document.createElement('small');
            small.style.color = 'var(--md-sys-color-on-surface-variant)';
            small.style.fontSize = '0.8rem';
            small.textContent = p.description;
            group.appendChild(small);
        }

        if (isAutoResolved) {
            const note = document.createElement('small');
            note.style.color = 'var(--md-sys-color-primary)';
            note.style.fontSize = '0.75rem';
            note.style.fontStyle = 'italic';
            note.textContent = 'Variable ' + p.default.match(/\{\{[^}]+\}\}/)[0] + ' always resolves to the selected version';
            group.appendChild(note);
        }

        container.appendChild(group);
    });

    // After rendering, apply initial version-based filtering: grey out
    // image options that don't match the current Kubernetes version.
    const versionSelect = document.getElementById('clusterVersion');
    if (versionSelect && versionSelect.value) {
        filterImageDropdown([versionSelect.value]);
    }
    // Apply initial generic constraints so the form is coherent.
    applyParameterConstraints();
}
