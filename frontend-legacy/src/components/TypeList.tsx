import { useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmDialog from './ConfirmDialog';

interface TypeItem {
  id: string;
  key: string;
  displayName: string;
  description: string | null;
}

interface Props {
  items: TypeItem[];
  basePath: string;
  onDelete: (id: string) => void;
}

export default function TypeList({ items, basePath, onDelete }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<TypeItem | null>(null);

  if (items.length === 0) {
    return <p className="text-gray-400 text-sm italic">None yet.</p>;
  }
  return (
    <>
      <ul className="divide-y divide-gray-200">
        {items.map((item) => (
          <li key={item.id} className="py-3 flex items-center justify-between">
            <Link to={`${basePath}/${item.id}`} className="flex-1">
              <span className="font-medium text-gray-900">{item.displayName}</span>
              <span className="ml-2 text-sm text-gray-400 font-mono">{item.key}</span>
              {item.description && (
                <span className="ml-3 text-sm text-gray-500">{item.description}</span>
              )}
            </Link>
            <button
              onClick={() => setDeleteTarget(item)}
              className="ml-4 text-sm text-red-600 hover:text-red-800"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Type"
        description={`Delete "${deleteTarget?.displayName}"?`}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
