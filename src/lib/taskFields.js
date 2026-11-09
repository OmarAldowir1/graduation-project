// Custom task fields: team-defined properties such as "Estimate", "Sprint" or "Link".
// Definitions live in task_fields; values live in tasks.fields as { fieldId: value }.
import { supabase } from './supabase.js';
import { escapeHtml } from './sanitize.js';

export const FIELD_TYPES = {
  text: 'Text',
  number: 'Number',
  select: 'Choice list',
  date: 'Date',
  url: 'Link',
  checkbox: 'Checkbox'
};

let cache = { workspaceId: null, fields: [], at: 0 };

export async function loadTaskFields(workspaceId, { fresh = false } = {}) {
  if (!workspaceId) return [];
  if (!fresh && cache.workspaceId === workspaceId && Date.now() - cache.at < 30000) return cache.fields;
  const { data, error } = await supabase.from('task_fields').select('*').eq('workspace_id', workspaceId).order('position').order('created_at');
  const fields = error ? [] : data || [];
  cache = { workspaceId, fields, at: Date.now() };
  return fields;
}

export function invalidateTaskFields() {
  cache = { workspaceId: null, fields: [], at: 0 };
}

export async function createTaskField(workspaceId, { name, fieldType, options = [] }) {
  const { data, error } = await supabase.from('task_fields').insert({
    workspace_id: workspaceId,
    name: String(name).trim().slice(0, 40),
    field_type: fieldType,
    options: fieldType === 'select' ? options.map((option) => String(option).trim()).filter(Boolean).slice(0, 30) : [],
    position: Date.now() % 2147483647
  }).select().single();
  invalidateTaskFields();
  return { data, error };
}

export async function deleteTaskField(fieldId) {
  const { error } = await supabase.from('task_fields').delete().eq('id', fieldId);
  invalidateTaskFields();
  return { error };
}

// Normalise a raw form value for storage. Returns undefined to clear the field.
export function normalizeFieldValue(field, raw) {
  if (field.field_type === 'checkbox') return Boolean(raw) || undefined;
  const value = String(raw ?? '').trim();
  if (!value) return undefined;
  if (field.field_type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (field.field_type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  if (field.field_type === 'url') return /^https?:\/\/\S+$/i.test(value) ? value.slice(0, 500) : undefined;
  if (field.field_type === 'select') return (field.options || []).includes(value) ? value : undefined;
  return value.slice(0, 500);
}

export function renderFieldValue(field, value) {
  if (value === undefined || value === null || value === '' || value === false) return '<span class="task-muted">—</span>';
  if (field.field_type === 'checkbox') return '<span class="material-symbols-outlined task-check-on" aria-label="Yes">check_box</span>';
  if (field.field_type === 'url' && /^https?:\/\//i.test(String(value))) {
    let host = String(value);
    try { host = new URL(String(value)).hostname; } catch { /* keep raw */ }
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a>`;
  }
  if (field.field_type === 'select') return `<span class="task-field-chip">${escapeHtml(value)}</span>`;
  return escapeHtml(String(value));
}

// Form inputs for the task details panel.
export function renderFieldInputs(fields, values = {}) {
  if (!fields.length) return '';
  return `<div class="task-detail-fields task-custom-fields">${fields.map((field) => {
    const name = `field_${field.id}`;
    const value = values?.[field.id];
    const label = escapeHtml(field.name);
    switch (field.field_type) {
      case 'checkbox':
        return `<label class="task-field-checkbox"><input type="checkbox" name="${name}" ${value ? 'checked' : ''} /> ${label}</label>`;
      case 'select':
        return `<label>${label}<select name="${name}"><option value="">—</option>${(field.options || []).map((option) => `<option ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
      case 'number':
        return `<label>${label}<input name="${name}" type="number" step="any" value="${escapeHtml(value ?? '')}" /></label>`;
      case 'date':
        return `<label>${label}<input name="${name}" type="date" value="${escapeHtml(value ?? '')}" /></label>`;
      case 'url':
        return `<label>${label}<input name="${name}" type="url" placeholder="https://" value="${escapeHtml(value ?? '')}" /></label>`;
      default:
        return `<label>${label}<input name="${name}" value="${escapeHtml(value ?? '')}" maxlength="500" /></label>`;
    }
  }).join('')}</div>`;
}

export function readFieldInputs(form, fields, previous = {}) {
  const next = { ...(previous || {}) };
  for (const field of fields) {
    const input = form.elements[`field_${field.id}`];
    if (!input) continue;
    const value = normalizeFieldValue(field, field.field_type === 'checkbox' ? input.checked : input.value);
    if (value === undefined) delete next[field.id];
    else next[field.id] = value;
  }
  return next;
}

// Small manager dialog: list fields, add one, remove one.
export async function openFieldManager(workspaceId, onChange = () => {}) {
  const { requestForm, requestConfirmation } = await import('./dialogs.js');
  const fields = await loadTaskFields(workspaceId, { fresh: true });
  const choice = await requestForm({
    title: 'Custom task fields',
    description: fields.length
      ? `Current fields: ${fields.map((field) => `${field.name} (${FIELD_TYPES[field.field_type]})`).join(', ')}. Add another below, or pick one to remove.`
      : 'Add properties your team tracks on every task, like Estimate, Sprint, Client or a Link.',
    submitLabel: 'Save',
    fields: [
      { name: 'name', label: 'New field name', placeholder: 'e.g. Estimate (hours)', maxLength: 40 },
      { name: 'fieldType', label: 'Type', type: 'select', value: 'text', half: true, options: Object.entries(FIELD_TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'options', label: 'Choices (for a choice list)', half: true, placeholder: 'Low, Medium, High', hint: 'Separate with commas' },
      ...(fields.length ? [{ name: 'remove', label: 'Remove a field', type: 'select', value: '', options: [{ value: '', label: 'Keep all fields' }, ...fields.map((field) => ({ value: field.id, label: `Remove “${field.name}”` }))] }] : [])
    ]
  });
  if (!choice) return;
  let changed = false;
  if (choice.remove) {
    const field = fields.find((item) => item.id === choice.remove);
    if (field && await requestConfirmation(`Remove the field “${field.name}”? Values already entered on tasks will be hidden.`)) {
      const { error } = await deleteTaskField(field.id);
      if (error) throw error;
      changed = true;
    }
  }
  if (choice.name) {
    if (choice.fieldType === 'select' && !choice.options.trim()) throw new Error('Add at least one choice for a choice list.');
    const { error } = await createTaskField(workspaceId, { name: choice.name, fieldType: choice.fieldType, options: choice.options.split(',') });
    if (error) throw error;
    changed = true;
  }
  if (changed) await onChange();
}
