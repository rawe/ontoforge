interface Props {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

export default function Pagination({ total, limit, offset, onChange }: Props) {
  if (total === 0) return null;

  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>Showing {start}&ndash;{end} of {total}</span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(0, offset - limit))}
          disabled={!hasPrev}
          className="px-3 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Previous
        </button>
        <button
          onClick={() => onChange(offset + limit)}
          disabled={!hasNext}
          className="px-3 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
