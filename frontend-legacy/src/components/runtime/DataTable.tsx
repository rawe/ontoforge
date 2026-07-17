interface Column {
  key: string;
  label: string;
  sortable?: boolean;
}

interface Props {
  columns: Column[];
  rows: Record<string, unknown>[];
  idKey?: string;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatCell(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    // Attempt to format dates
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d.toLocaleDateString();
    }
    return value;
  }
  return String(value);
}

export default function DataTable({ columns, rows, idKey = '_id', sortKey, sortOrder, onSort, onEdit, onDelete }: Props) {
  const sortIndicator = (key: string) => {
    if (key !== sortKey) return '';
    return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          {columns.map((col) => (
            <th
              key={col.key}
              className={`py-2 pr-4 ${col.sortable && onSort ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
              onClick={col.sortable && onSort ? () => { onSort(col.key); } : undefined}
            >
              {col.label}{col.sortable ? sortIndicator(col.key) : ''}
            </th>
          ))}
          <th className="py-2 w-24">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + 1} className="py-6 text-center text-gray-400 italic">
              No records found.
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const id = String(row[idKey]);
            return (
              <tr key={id} className="border-b border-gray-100 hover:bg-gray-50">
                {columns.map((col) => (
                  <td key={col.key} className="py-2 pr-4 max-w-xs truncate">
                    {formatCell(row[col.key])}
                  </td>
                ))}
                <td className="py-2 flex gap-2">
                  <button onClick={() => onEdit(id)} className="text-blue-600 hover:text-blue-800 text-xs">Edit</button>
                  <button onClick={() => onDelete(id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
