import { useState } from 'react';

interface Props {
  initial?: { name: string; description: string };
  onSubmit: (data: { name: string; description?: string }) => void;
  onCancel: () => void;
}

export default function OntologyForm({ initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() || undefined });
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
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        rows={2}
      />
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
          {initial ? 'Save' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-sm rounded hover:bg-gray-300">
          Cancel
        </button>
      </div>
    </form>
  );
}
