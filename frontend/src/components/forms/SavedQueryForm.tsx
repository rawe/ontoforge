import { useState } from 'react';
import type { DataType } from '../../types/models';

const DATA_TYPE_OPTIONS: DataType[] = ['string', 'integer', 'float', 'boolean', 'date', 'datetime'];

interface ParameterRow {
  name: string;
  description: string;
  dataType: DataType;
}

interface Props {
  initial?: {
    key: string;
    name: string;
    description: string;
    cypher: string;
    parameters: ParameterRow[];
  };
  onSubmit: (data: {
    key: string;
    name: string;
    description: string;
    cypher: string;
    parameters: ParameterRow[];
  }) => void;
  onCancel: () => void;
}

export default function SavedQueryForm({ initial, onSubmit, onCancel }: Props) {
  const isEdit = !!initial;
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cypher, setCypher] = useState(initial?.cypher ?? '');
  const [parameters, setParameters] = useState<ParameterRow[]>(
    initial?.parameters ?? [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !cypher.trim()) return;
    if (!isEdit && !key.trim()) return;
    onSubmit({
      key: isEdit ? initial!.key : key.trim(),
      name: name.trim(),
      description: description.trim(),
      cypher: cypher.trim(),
      parameters,
    });
  };

  const addParameter = () => {
    setParameters([...parameters, { name: '', description: '', dataType: 'string' }]);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const updateParameter = (index: number, field: keyof ParameterRow, value: string) => {
    setParameters(parameters.map((p, i) =>
      i === index ? { ...p, [field]: value } : p,
    ));
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-gray-50 border rounded-lg p-4">
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
      <textarea
        placeholder="Cypher query (use $param for parameters)"
        value={cypher}
        onChange={(e) => setCypher(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        rows={4}
        required
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Parameters</p>
          <button
            type="button"
            onClick={addParameter}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + Add parameter
          </button>
        </div>
        {parameters.length === 0 && (
          <p className="text-sm text-gray-400 italic">No parameters. Add parameters to match $param placeholders in the Cypher query.</p>
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
