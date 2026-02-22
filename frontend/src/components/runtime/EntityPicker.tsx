import { useState, useEffect, useRef } from 'react';
import * as runtimeApi from '../../api/runtimeClient';
import type { EntityInstance } from '../../types/runtime';

interface Props {
  ontologyKey: string;
  entityTypeKey: string;
  value: string | null;
  onChange: (id: string) => void;
  label: string;
}

function getDisplayLabel(entity: EntityInstance): string {
  // Use first string property value as display label, fallback to _id
  for (const [key, val] of Object.entries(entity)) {
    if (key.startsWith('_')) continue;
    if (key === 'fromEntityId' || key === 'toEntityId') continue;
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return entity._id;
}

export default function EntityPicker({ ontologyKey, entityTypeKey, value, onChange, label }: Props) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<EntityInstance[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load display label for pre-selected value
  useEffect(() => {
    if (!value) { setSelectedLabel(''); return; }
    runtimeApi.getEntity(ontologyKey, entityTypeKey, value)
      .then((e) => setSelectedLabel(getDisplayLabel(e)))
      .catch(() => setSelectedLabel(value));
  }, [value, ontologyKey, entityTypeKey]);

  const doSearch = (term: string) => {
    runtimeApi.listEntities(ontologyKey, entityTypeKey, { limit: 20, q: term || undefined })
      .then((res) => {
        setOptions(res.items);
        setShowDropdown(true);
      })
      .catch(() => setOptions([]));
  };

  const handleInputChange = (val: string) => {
    setSearch(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (entity: EntityInstance) => {
    onChange(entity._id);
    setSelectedLabel(getDisplayLabel(entity));
    setSearch('');
    setShowDropdown(false);
  };

  const handleFocus = () => {
    doSearch(search);
  };

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}<span className="text-red-500 ml-0.5">*</span>
      </label>
      {value && selectedLabel ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-800">{selectedLabel}</span>
          <button
            type="button"
            onClick={() => { onChange(''); setSelectedLabel(''); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            clear
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={search}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={`Search ${entityTypeKey}...`}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      )}
      {showDropdown && options.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-auto">
          {options.map((entity) => (
            <li key={entity._id}>
              <button
                type="button"
                onMouseDown={() => handleSelect(entity)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
              >
                {getDisplayLabel(entity)}
                <span className="ml-2 text-xs text-gray-400 font-mono">{entity._id.slice(0, 8)}...</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
