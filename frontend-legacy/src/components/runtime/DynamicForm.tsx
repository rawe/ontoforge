import { useState } from 'react';
import type { RuntimePropertyDef } from '../../types/runtime';

interface Props {
  properties: RuntimePropertyDef[];
  initialValues?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
  errors?: Record<string, string>;
  loading?: boolean;
  children?: React.ReactNode;
}

export default function DynamicForm({ properties, initialValues, onSubmit, onCancel, errors, loading, children }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const prop of properties) {
      if (initialValues && prop.key in initialValues) {
        init[prop.key] = initialValues[prop.key] ?? '';
      } else {
        init[prop.key] = prop.dataType === 'boolean' ? false : '';
      }
    }
    return init;
  });

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result: Record<string, unknown> = {};

    for (const prop of properties) {
      const raw = values[prop.key];
      const initial = initialValues?.[prop.key];
      const isEmpty = raw === '' || raw == null;

      if (initialValues) {
        // Edit mode: only send changed fields
        const initialEmpty = initial === '' || initial == null || initial === undefined;
        if (isEmpty && initialEmpty) continue;
        if (raw === initial) continue;
        if (isEmpty && !initialEmpty) {
          // Cleared an optional field → send null
          result[prop.key] = null;
          continue;
        }
      } else {
        // Create mode: skip empty optional fields
        if (isEmpty && !prop.required) continue;
      }

      // Coerce value to expected type
      result[prop.key] = coerce(raw, prop.dataType);
    }

    onSubmit(result);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {children}
      {properties.map((prop) => (
        <div key={prop.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {prop.displayName}
            {prop.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {renderInput(prop, values[prop.key], (v) => handleChange(prop.key, v))}
          {errors?.[prop.key] && (
            <p className="text-red-500 text-xs mt-1">{errors[prop.key]}</p>
          )}
          {prop.description && (
            <p className="text-gray-400 text-xs mt-0.5">{prop.description}</p>
          )}
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function renderInput(
  prop: RuntimePropertyDef,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const base = "w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

  switch (prop.dataType) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
      );
    case 'integer':
      return (
        <input
          type="number"
          step="1"
          value={value === '' || value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={prop.required}
          className={base}
        />
      );
    case 'float':
      return (
        <input
          type="number"
          step="any"
          value={value === '' || value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={prop.required}
          className={base}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={prop.required}
          className={base}
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={prop.required}
          className={base}
        />
      );
    default: // string
      return (
        <input
          type="text"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          required={prop.required}
          className={base}
        />
      );
  }
}

function coerce(value: unknown, dataType: string): unknown {
  if (value === '' || value == null) return null;
  switch (dataType) {
    case 'integer': return parseInt(String(value), 10);
    case 'float': return parseFloat(String(value));
    case 'boolean': return Boolean(value);
    default: return String(value);
  }
}
