import { useState } from 'react';
import type { DataType, StepType, SavedQueryStep } from '../../types/models';

const DATA_TYPE_OPTIONS: DataType[] = ['string', 'integer', 'float', 'boolean', 'date', 'datetime'];
const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: 'cypher', label: 'Cypher' },
  { value: 'semantic_search', label: 'Semantic Search' },
];

interface ParameterRow {
  name: string;
  description: string;
  dataType: DataType;
}

interface StepRow {
  name: string;
  type: StepType;
  cypher: string;
  entityTypeKey: string;
  query: string;
  limit: string;
  minScore: string;
  bindings: { key: string; value: string }[];
}

function emptyStep(): StepRow {
  return { name: '', type: 'cypher', cypher: '', entityTypeKey: '', query: '', limit: '', minScore: '', bindings: [] };
}

function stepToApi(s: StepRow): SavedQueryStep {
  const result: SavedQueryStep = { name: s.name, type: s.type };
  if (s.type === 'cypher') {
    result.cypher = s.cypher;
  } else {
    result.entityTypeKey = s.entityTypeKey;
    result.query = s.query;
    if (s.limit) result.limit = parseInt(s.limit, 10);
    if (s.minScore) result.minScore = parseFloat(s.minScore);
  }
  if (s.bindings.length > 0) {
    const b: Record<string, string> = {};
    for (const { key, value } of s.bindings) {
      if (key.trim() && value.trim()) b[key.trim()] = value.trim();
    }
    if (Object.keys(b).length > 0) result.bindings = b;
  }
  return result;
}

function apiToStep(s: SavedQueryStep): StepRow {
  const bindings: { key: string; value: string }[] = [];
  if (s.bindings) {
    for (const [k, v] of Object.entries(s.bindings)) {
      bindings.push({ key: k, value: v });
    }
  }
  return {
    name: s.name,
    type: s.type,
    cypher: s.cypher ?? '',
    entityTypeKey: s.entityTypeKey ?? '',
    query: s.query ?? '',
    limit: s.limit?.toString() ?? '',
    minScore: s.minScore?.toString() ?? '',
    bindings,
  };
}

interface Props {
  initial?: {
    key: string;
    name: string;
    description: string;
    steps: SavedQueryStep[];
    parameters: ParameterRow[];
  };
  onSubmit: (data: {
    key: string;
    name: string;
    description: string;
    steps: SavedQueryStep[];
    parameters: ParameterRow[];
  }) => void;
  onCancel: () => void;
}

export default function SavedQueryForm({ initial, onSubmit, onCancel }: Props) {
  const isEdit = !!initial;
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState<StepRow[]>(
    initial?.steps.map(apiToStep) ?? [emptyStep()],
  );
  const [parameters, setParameters] = useState<ParameterRow[]>(
    initial?.parameters ?? [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim() || steps.length === 0) return;
    if (!isEdit && !key.trim()) return;
    // Validate each step has required fields
    for (const s of steps) {
      if (!s.name.trim()) return;
      if (s.type === 'cypher' && !s.cypher.trim()) return;
      if (s.type === 'semantic_search' && (!s.entityTypeKey.trim() || !s.query.trim())) return;
    }
    onSubmit({
      key: isEdit ? initial!.key : key.trim(),
      name: name.trim(),
      description: description.trim(),
      steps: steps.map(stepToApi),
      parameters,
    });
  };

  // --- Step management ---
  const addStep = () => setSteps([...steps, emptyStep()]);
  const removeStep = (index: number) => setSteps(steps.filter((_, i) => i !== index));
  const updateStep = (index: number, patch: Partial<StepRow>) => {
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const copy = [...steps];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setSteps(copy);
  };

  // --- Binding management ---
  const addBinding = (stepIndex: number) => {
    updateStep(stepIndex, { bindings: [...steps[stepIndex].bindings, { key: '', value: '' }] });
  };
  const removeBinding = (stepIndex: number, bindIndex: number) => {
    updateStep(stepIndex, { bindings: steps[stepIndex].bindings.filter((_, i) => i !== bindIndex) });
  };
  const updateBinding = (stepIndex: number, bindIndex: number, field: 'key' | 'value', val: string) => {
    const updated = steps[stepIndex].bindings.map((b, i) =>
      i === bindIndex ? { ...b, [field]: val } : b,
    );
    updateStep(stepIndex, { bindings: updated });
  };

  // --- Parameter management ---
  const addParameter = () => {
    setParameters([...parameters, { name: '', description: '', dataType: 'string' }]);
  };
  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };
  const updateParameter = (index: number, field: keyof ParameterRow, value: string) => {
    setParameters(parameters.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-gray-50 border rounded-lg p-4">
      {/* Key (create only) */}
      {!isEdit && (
        <input
          type="text"
          placeholder="Query key (e.g. find-by-name)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          pattern="^[a-z][a-z0-9_-]*$"
          title="Lowercase letters, numbers, underscores, hyphens. Must start with a letter."
          className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          required
        />
      )}
      <input
        type="text"
        placeholder="Query name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      <textarea
        placeholder="Description (required)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        rows={2}
        required
      />

      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Pipeline Steps</p>
          <button type="button" onClick={addStep} className="text-sm text-blue-600 hover:text-blue-800">
            + Add step
          </button>
        </div>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="border border-gray-200 rounded-lg bg-white p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono w-5 shrink-0">#{i + 1}</span>
                <input
                  type="text"
                  placeholder="Step name"
                  value={step.name}
                  onChange={(e) => updateStep(i, { name: e.target.value })}
                  pattern="^[a-zA-Z_]\w*$"
                  title="Letters, numbers, underscores. Must start with a letter or underscore."
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono w-36"
                  required
                />
                <select
                  value={step.type}
                  onChange={(e) => updateStep(i, { type: e.target.value as StepType })}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  {STEP_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="flex gap-1 ml-auto">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1" title="Move up">&uarr;</button>
                  <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1" title="Move down">&darr;</button>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-red-500 hover:text-red-700 text-sm px-1">Remove</button>
                  )}
                </div>
              </div>

              {/* Cypher step fields */}
              {step.type === 'cypher' && (
                <textarea
                  placeholder="Cypher query (use $param for parameters)"
                  value={step.cypher}
                  onChange={(e) => updateStep(i, { cypher: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                  rows={3}
                  required
                />
              )}

              {/* Semantic search step fields */}
              {step.type === 'semantic_search' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Entity type key (e.g. skill)"
                      value={step.entityTypeKey}
                      onChange={(e) => updateStep(i, { entityTypeKey: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono flex-1"
                      required
                    />
                    <input
                      type="text"
                      placeholder="Query (e.g. $skill_query)"
                      value={step.query}
                      onChange={(e) => updateStep(i, { query: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono flex-1"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Limit (default 10)"
                      value={step.limit}
                      onChange={(e) => updateStep(i, { limit: e.target.value })}
                      min={1}
                      max={100}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32"
                    />
                    <input
                      type="number"
                      placeholder="Min score (0-1)"
                      value={step.minScore}
                      onChange={(e) => updateStep(i, { minScore: e.target.value })}
                      min={0}
                      max={1}
                      step={0.05}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32"
                    />
                  </div>
                </div>
              )}

              {/* Bindings */}
              {i > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Bindings (map params to previous step outputs)</p>
                    <button type="button" onClick={() => addBinding(i)} className="text-xs text-blue-600 hover:text-blue-800">
                      + Add binding
                    </button>
                  </div>
                  {step.bindings.map((b, bi) => (
                    <div key={bi} className="flex gap-2 items-center mt-1">
                      <input
                        type="text"
                        placeholder="param name"
                        value={b.key}
                        onChange={(e) => updateBinding(i, bi, 'key', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-xs font-mono w-32"
                      />
                      <span className="text-xs text-gray-400">=</span>
                      <input
                        type="text"
                        placeholder="{{stepName.field}}"
                        value={b.value}
                        onChange={(e) => updateBinding(i, bi, 'value', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-xs font-mono flex-1"
                      />
                      <button type="button" onClick={() => removeBinding(i, bi)} className="text-red-500 hover:text-red-700 text-xs px-1">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Parameters</p>
          <button type="button" onClick={addParameter} className="text-sm text-blue-600 hover:text-blue-800">
            + Add parameter
          </button>
        </div>
        {parameters.length === 0 && (
          <p className="text-sm text-gray-400 italic">No parameters. Add parameters to match $param placeholders in the pipeline steps.</p>
        )}
        <div className="space-y-2">
          {parameters.map((param, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                type="text"
                placeholder="name"
                value={param.name}
                onChange={(e) => updateParameter(i, 'name', e.target.value)}
                pattern="^[a-zA-Z_]\w*$"
                title="Valid parameter name"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono w-32"
                required
              />
              <input
                type="text"
                placeholder="description"
                value={param.description}
                onChange={(e) => updateParameter(i, 'description', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1"
                required
              />
              <select
                value={param.dataType}
                onChange={(e) => updateParameter(i, 'dataType', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {DATA_TYPE_OPTIONS.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeParameter(i)}
                className="text-red-500 hover:text-red-700 text-sm px-1"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
          {isEdit ? 'Save' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-sm rounded hover:bg-gray-300">
          Cancel
        </button>
      </div>
    </form>
  );
}
