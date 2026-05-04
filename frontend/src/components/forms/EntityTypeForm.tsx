import { useState } from 'react';
import type { PropertyDefinition } from '../../types/models';

interface Initial {
  key: string;
  displayName: string;
  description: string;
  displayNameProperty?: string | null;
  defaultSearchProperties?: string[] | null;
}

interface SubmitData {
  key: string;
  displayName: string;
  description?: string;
  displayNameProperty?: string | null;
  defaultSearchProperties?: string[] | null;
}

interface Props {
  initial?: Initial;
  properties?: PropertyDefinition[];
  onSubmit: (data: SubmitData) => void;
  onCancel: () => void;
}

export default function EntityTypeForm({ initial, properties, onSubmit, onCancel }: Props) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [displayNameProperty, setDisplayNameProperty] = useState<string>(
    initial?.displayNameProperty ?? '',
  );
  const [searchProps, setSearchProps] = useState<string[]>(
    initial?.defaultSearchProperties ?? [],
  );
  const isEdit = !!initial;
  const showAdvanced = isEdit && properties !== undefined;
  const hasProperties = (properties?.length ?? 0) > 0;

  const stringProperties = (properties ?? []).filter((p) => p.dataType === 'string');
  const propertyByKey = new Map((properties ?? []).map((p) => [p.key, p]));
  const existingKeys = new Set((properties ?? []).map((p) => p.key));

  // Derive displayed values from current state, dropping any keys that no
  // longer correspond to a property (e.g. property was deleted while editing).
  // The submit path uses the derived values, so the user can never persist
  // dangling references.
  const effectiveDisplayNameProperty =
    displayNameProperty && existingKeys.has(displayNameProperty) ? displayNameProperty : '';
  const effectiveSearchProps = properties === undefined
    ? searchProps
    : searchProps.filter((k) => existingKeys.has(k));

  const moveSelected = (index: number, delta: number) => {
    const next = [...effectiveSearchProps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setSearchProps(next);
  };

  const removeSelected = (propKey: string) => {
    setSearchProps(effectiveSearchProps.filter((k) => k !== propKey));
  };

  const addSelected = (propKey: string) => {
    if (effectiveSearchProps.includes(propKey)) return;
    setSearchProps([...effectiveSearchProps, propKey]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !displayName.trim()) return;
    const base: SubmitData = {
      key: key.trim(),
      displayName: displayName.trim(),
      description: description.trim() || undefined,
    };
    if (showAdvanced) {
      base.displayNameProperty = effectiveDisplayNameProperty || null;
      base.defaultSearchProperties = effectiveSearchProps;
    }
    onSubmit(base);
  };

  const availableForSearch = (properties ?? []).filter((p) => !effectiveSearchProps.includes(p.key));

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        placeholder="Key (e.g. person)"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        pattern="^[a-z][a-z0-9_]*$"
        title="Lowercase letters, numbers, underscores. Must start with a letter."
        className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        required
        disabled={isEdit}
      />
      <input
        type="text"
        placeholder="Display Name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        rows={2}
      />

      {showAdvanced && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Display name property</label>
            <p className="text-xs text-gray-500">
              Used as the human-readable label for instances of this type. Only string properties are listed.
            </p>
            <select
              value={effectiveDisplayNameProperty}
              onChange={(e) => setDisplayNameProperty(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              disabled={!hasProperties}
            >
              <option value="">(none — no display name)</option>
              {stringProperties.map((p) => (
                <option key={p.propertyId} value={p.key}>
                  {p.displayName} ({p.key})
                </option>
              ))}
            </select>
            {!hasProperties && (
              <p className="text-xs text-gray-400 italic">Add a property first to configure this field.</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Default search properties</label>
            <p className="text-xs text-gray-500">
              Properties returned by cross-type semantic search when no projection is specified. Order is preserved.
            </p>
            {!hasProperties ? (
              <p className="text-xs text-gray-400 italic">Add a property first to configure this field.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="border border-gray-300 rounded p-2 bg-gray-50">
                  <p className="text-xs font-medium text-gray-600 mb-1">Selected (in order)</p>
                  {effectiveSearchProps.length === 0 ? (
                    <p className="text-xs italic text-gray-400">None selected.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {effectiveSearchProps.map((propKey, index) => {
                        const prop = propertyByKey.get(propKey);
                        const label = prop ? `${prop.displayName} (${prop.key})` : propKey;
                        return (
                          <li key={propKey} className="flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1 text-sm">
                            <span className="text-xs text-gray-400 w-5 text-right">{index + 1}.</span>
                            <span className="flex-1">{label}</span>
                            <button
                              type="button"
                              onClick={() => moveSelected(index, -1)}
                              disabled={index === 0}
                              className="text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed px-1"
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSelected(index, 1)}
                              disabled={index === effectiveSearchProps.length - 1}
                              className="text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed px-1"
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSelected(propKey)}
                              className="text-xs text-red-600 hover:text-red-800 px-1"
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="border border-gray-300 rounded p-2">
                  <p className="text-xs font-medium text-gray-600 mb-1">Available</p>
                  {availableForSearch.length === 0 ? (
                    <p className="text-xs italic text-gray-400">All properties selected.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {availableForSearch.map((p) => (
                        <li key={p.propertyId} className="flex items-center gap-2 text-sm">
                          <span className="flex-1">
                            {p.displayName} <span className="text-gray-400">({p.key})</span>
                            <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-500">{p.dataType}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => addSelected(p.key)}
                            className="text-xs text-blue-600 hover:text-blue-800 px-1"
                          >
                            Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

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
