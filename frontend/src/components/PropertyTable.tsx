import { useState } from 'react';
import type { PropertyDefinition } from '../types/models';
import PropertyForm from './forms/PropertyForm';

interface Props {
  properties: PropertyDefinition[];
  onAdd: (data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string }) => void;
  onDelete: (propertyId: string) => void;
}

export default function PropertyTable({ properties, onAdd, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold text-gray-700">Properties</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : 'Add Property'}
        </button>
      </div>
      {showForm && (
        <div className="mb-4 p-3 bg-gray-50 rounded border">
          <PropertyForm
            onSubmit={(data) => { onAdd(data); setShowForm(false); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}
      {properties.length === 0 ? (
        <p className="text-gray-400 text-sm italic">No properties defined.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Key</th>
              <th className="py-2 pr-4">Display Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Required</th>
              <th className="py-2 pr-4">Default</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {properties.map((prop) => (
              <tr key={prop.propertyId} className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-gray-800">{prop.key}</td>
                <td className="py-2 pr-4">{prop.displayName}</td>
                <td className="py-2 pr-4"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{prop.dataType}</span></td>
                <td className="py-2 pr-4">{prop.required ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-4 text-gray-500">{prop.defaultValue ?? '—'}</td>
                <td className="py-2">
                  <button
                    onClick={() => { if (confirm(`Delete property "${prop.key}"?`)) onDelete(prop.propertyId); }}
                    className="text-red-600 hover:text-red-800 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
