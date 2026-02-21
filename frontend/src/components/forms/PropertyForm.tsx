import { useState } from 'react';
import type { DataType } from '../../types/models';

const DATA_TYPES: DataType[] = ['string', 'integer', 'float', 'boolean', 'date', 'datetime'];

interface Props {
  onSubmit: (data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string }) => void;
  onCancel: () => void;
}

export default function PropertyForm({ onSubmit, onCancel }: Props) {
  const [key, setKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [dataType, setDataType] = useState<DataType>('string');
  const [required, setRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !displayName.trim()) return;
    onSubmit({
      key: key.trim(),
      displayName: displayName.trim(),
      description: description.trim() || undefined,
      dataType,
      required,
      defaultValue: defaultValue.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
      <input
        type="text"
        placeholder="Key (e.g. first_name)"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        pattern="^[a-z][a-z0-9_]*$"
        title="Lowercase letters, numbers, underscores"
        className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        required
      />
      <input
        type="text"
        placeholder="Display Name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      <select
        value={dataType}
        onChange={(e) => setDataType(e.target.value as DataType)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
      >
        {DATA_TYPES.map((dt) => (
          <option key={dt} value={dt}>{dt}</option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Default value (optional)"
        value={defaultValue}
        onChange={(e) => setDefaultValue(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm"
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
        rows={1}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required
      </label>
      <div className="flex gap-2 justify-end">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
          Add
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-sm rounded hover:bg-gray-300">
          Cancel
        </button>
      </div>
    </form>
  );
}
