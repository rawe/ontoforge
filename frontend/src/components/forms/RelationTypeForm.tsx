import { useState } from 'react';
import type { EntityType } from '../../types/models';

interface Props {
  entityTypes: EntityType[];
  initial?: { key: string; displayName: string; description: string; sourceEntityTypeKey: string; targetEntityTypeKey: string; factTemplate?: string | null };
  defaultSourceKey?: string;
  defaultTargetKey?: string;
  onSubmit: (data: { key: string; displayName: string; description?: string; sourceEntityTypeKey: string; targetEntityTypeKey: string; factTemplate: string | null }) => void;
  onCancel: () => void;
}

export default function RelationTypeForm({ entityTypes, initial, defaultSourceKey, defaultTargetKey, onSubmit, onCancel }: Props) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [sourceKey, setSourceKey] = useState(initial?.sourceEntityTypeKey ?? defaultSourceKey ?? '');
  const [targetKey, setTargetKey] = useState(initial?.targetEntityTypeKey ?? defaultTargetKey ?? '');
  const [factTemplate, setFactTemplate] = useState<string>(initial?.factTemplate ?? '');
  const isEdit = !!initial;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !displayName.trim() || !sourceKey || !targetKey) return;
    const trimmedTemplate = factTemplate.trim();
    onSubmit({
      key: key.trim(),
      displayName: displayName.trim(),
      description: description.trim() || undefined,
      sourceEntityTypeKey: sourceKey,
      targetEntityTypeKey: targetKey,
      factTemplate: trimmedTemplate === '' ? null : trimmedTemplate,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        placeholder="Key (e.g. works_at)"
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
      <select
        value={sourceKey}
        onChange={(e) => setSourceKey(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
        disabled={isEdit}
      >
        <option value="">Source entity type...</option>
        {entityTypes.map((et) => (
          <option key={et.entityTypeId} value={et.key}>{et.displayName} ({et.key})</option>
        ))}
      </select>
      <select
        value={targetKey}
        onChange={(e) => setTargetKey(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
        disabled={isEdit}
      >
        <option value="">Target entity type...</option>
        {entityTypes.map((et) => (
          <option key={et.entityTypeId} value={et.key}>{et.displayName} ({et.key})</option>
        ))}
      </select>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Fact template</label>
        <p className="text-xs text-gray-500">
          Optional. If set, instances become semantically searchable via the rendered fact. Use {'{{ source.X }}'}, {'{{ target.X }}'}, {'{{ relation.X }}'}. {'{{ source.displayName }}'} is always available.
        </p>
        <textarea
          placeholder="{{ source.displayName }} works at {{ target.displayName }}"
          value={factTemplate}
          onChange={(e) => setFactTemplate(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          rows={4}
        />
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
