import { useState } from 'react';

interface Props {
  initial?: { name: string; description: string };
  onSubmit: (data: { name: string; key?: string; description?: string }) => void;
  onCancel: () => void;
}

export default function OntologyForm({ initial, onSubmit, onCancel }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState(initial?.description ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!isEdit && !key.trim()) return;
    onSubmit({
      name: name.trim(),
      ...(!isEdit && { key: key.trim() }),
      description: description.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        placeholder="Ontology name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      {!isEdit && (
        <input
          type="text"
          placeholder="Key (e.g. my_ontology)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          pattern="^[a-z][a-z0-9_]*$"
          title="Lowercase letters, numbers, underscores. Must start with a letter."
          className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          required
        />
      )}
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        rows={2}
      />
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
