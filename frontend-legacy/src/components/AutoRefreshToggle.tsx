interface Props {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export default function AutoRefreshToggle({ enabled, onToggle }: Props) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
        enabled
          ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
      }`}
      title={enabled ? 'Auto-refresh is ON (every 3s)' : 'Auto-refresh is OFF'}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
      Auto-refresh
    </button>
  );
}
