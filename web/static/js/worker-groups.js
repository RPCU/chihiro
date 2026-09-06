// Worker group schema, rendering, and collection.

// Seed values for a brand-new worker group from the schema defaults.
function defaultWorkerGroupValues() {
    const values = {};
    workerGroupFieldSchema().forEach(f => {
        if (f.default !== undefined && f.default !== null && f.default !== '') {
            values[f.key] = f.default;
        }
    });
    if (values.name === undefined) values.name = 'worker';
    return values;
}

// Returns the worker-group field schema, falling back to the legacy
// name/class/flavor/replicas layout if config hasn't loaded yet.
function workerGroupFieldSchema() {
    if (workerGroupFields && workerGroupFields.length > 0) {
        return workerGroupFields;
    }
    return [
        { key: 'name', label: 'Group name', type: 'string', required: true },
        { key: 'class', label: 'Class', type: 'string', default: 'default-worker' },
        { key: 'flavor', label: 'Flavor', type: 'string' },
        { key: 'replicas', label: 'Replicas', type: 'number', default: '1', min: 1, max: 10 }
    ];
}

function workerGroupFieldInputHTML(field, idx, prefix, value) {
    const id = `${prefix}-wg-${field.key}-${idx}`;
    const cls = `wg-field wg-field-${field.key}`;
    const val = (value !== undefined && value !== null) ? String(value) : '';
    if (field.type === 'select' && field.options && field.options.length > 0) {
        const opts = field.options.map(o =>
            `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`
        ).join('');
        return `<select id="${id}" class="${cls}" data-key="${escapeHtml(field.key)}">${opts}</select>`;
    }
    if (field.type === 'number') {
        const min = (field.min != null) ? ` min="${field.min}"` : '';
        const max = (field.max != null) ? ` max="${field.max}"` : '';
        const shown = val || (field.default || '');
        return `<input type="number" id="${id}" class="${cls}" data-key="${escapeHtml(field.key)}" value="${escapeHtml(shown)}"${min}${max}>`;
    }
    return `<input type="text" id="${id}" class="${cls}" data-key="${escapeHtml(field.key)}" value="${escapeHtml(val)}" placeholder="${escapeHtml(field.label || field.key)}">`;
}

function workerGroupRowHTML(idx, values, prefix) {
    const schema = workerGroupFieldSchema();
    const nameField = schema.find(f => f.key === 'name');
    const otherFields = schema.filter(f => f.key !== 'name');

    // Render the name field (if present) inline in the header next to the
    // delete button; everything else goes in the details row.
    let headerInput;
    if (nameField) {
        const nameVal = (values && values.name !== undefined) ? values.name : (nameField.default || '');
        headerInput = workerGroupFieldInputHTML(nameField, idx, prefix, nameVal).replace('class="wg-field', 'class="wg-name wg-field');
    } else {
        headerInput = '<span></span>';
    }

    const details = otherFields.map(f => {
        let v = (values && values[f.key] !== undefined) ? values[f.key] : (f.default || '');
        return `
            <span class="wg-label">${escapeHtml(f.label || f.key)}</span>
            ${workerGroupFieldInputHTML(f, idx, prefix, v)}
        `;
    }).join('');

    return `
        <div class="wg-header">
            ${headerInput}
            <button type="button" class="edit-btn" onclick="remove${prefix === 'create' ? 'Create' : 'Edit'}WorkerGroup(${idx})" style="color: var(--md-sys-color-error); border-color: var(--md-sys-color-error); flex: 0 0 auto;">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </div>
        <div class="wg-details">
            ${details}
        </div>
    `;
}

function collectWorkerGroups(prefix) {
    const container = document.getElementById(prefix === 'create' ? 'createWorkerGroups' : 'editWorkerGroupsList');
    const rows = container.querySelectorAll('.worker-group-row');
    const groups = [];
    rows.forEach(row => {
        const group = {};
        row.querySelectorAll('.wg-field').forEach(input => {
            const key = input.getAttribute('data-key');
            if (!key) return;
            let value = input.value.trim();
            if (input.type === 'number') {
                group[key] = parseInt(value) || 0;
            } else {
                group[key] = value;
            }
        });
        // A group needs a name to be meaningful.
        if (group.name) {
            groups.push(group);
        }
    });
    return groups;
}

// values is an object keyed by worker-group field key (e.g.
// { name: 'worker', flavor: 'xmedium', replicas: 1 }).
function addCreateWorkerGroup(values) {
    const container = document.getElementById('createWorkerGroups');
    const idx = createGroupIndex++;
    const div = document.createElement('div');
    div.className = 'worker-group-row';
    div.id = `create-wg-${idx}`;
    div.innerHTML = workerGroupRowHTML(idx, values || {}, 'create');
    container.appendChild(div);
}

function removeCreateWorkerGroup(idx) {
    const el = document.getElementById(`create-wg-${idx}`);
    if (el) el.remove();
}

function addEditWorkerGroup(values) {
    const container = document.getElementById('editWorkerGroupsList');
    const idx = editGroupIndex++;
    const div = document.createElement('div');
    div.className = 'worker-group-row';
    div.id = `edit-wg-${idx}`;
    div.innerHTML = workerGroupRowHTML(idx, values || {}, 'edit');
    container.appendChild(div);
}

function removeEditWorkerGroup(idx) {
    const el = document.getElementById(`edit-wg-${idx}`);
    if (el) el.remove();
}
