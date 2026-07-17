import { useState } from 'react';

const AVAILABLE_TOOLS = [
  { key: 'get_schema', label: 'Get Schema' },
  { key: 'list_entities', label: 'List Entities' },
  { key: 'get_entity', label: 'Get Entity' },
  { key: 'list_relations', label: 'List Relations' },
  { key: 'get_neighbors', label: 'Get Neighbors' },
  { key: 'semantic_search', label: 'Semantic Search' },
  { key: 'execute_cypher_query', label: 'Execute Cypher Query' },
  { key: 'list_saved_queries', label: 'List Saved Queries' },
  { key: 'run_saved_query', label: 'Run Saved Query' },
];

interface Props {
  initial?: {
    key: string;
    name: string;
    description: string | null;
    systemPrompt: string | null;
    tools: string[] | null;
  };
  onSubmit: (data: {
    key: string;
    name: string;
    description?: string | null;
    systemPrompt?: string | null;
    tools?: string[] | null;
  }) => void;
  onCancel: () => void;
}

export default function AiAgentForm({ initial, onSubmit, onCancel }: Props) {
  const isEdit = !!initial;
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '');
  const [toolMode, setToolMode] = useState<'all' | 'select'>(
    initial?.tools ? 'select' : 'all',
  );
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    () => new Set(initial?.tools ?? AVAILABLE_TOOLS.map((t) => t.key)),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!isEdit && !key.trim()) return;
    onSubmit({
      key: isEdit ? initial!.key : key.trim(),
      name: name.trim(),
      description: description.trim() || null,
      systemPrompt: systemPrompt.trim() || null,
      tools: toolMode === 'all' ? null : Array.from(selectedTools),
    });
  };

  const toggleTool = (toolKey: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolKey)) next.delete(toolKey);
      else next.add(toolKey);
      return next;
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-gray-50 border rounded-lg p-4">
      {!isEdit && (
        <input
          type="text"
          placeholder="Agent key (e.g. my-agent)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          pattern="^[a-z][a-z0-9_-]*$"
          title="Lowercase letters, numbers, underscores, hyphens. Must start with a letter."
          className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          required
        />
      )}
      <input
        type="text"
        placeholder="Agent name"
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
      <textarea
        placeholder="System prompt (optional)"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        rows={4}
      />

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Tools</p>
        <div className="flex gap-4 mb-2">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              checked={toolMode === 'all'}
              onChange={() => setToolMode('all')}
              className="text-blue-600 focus:ring-blue-500"
            />
            All tools
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              checked={toolMode === 'select'}
              onChange={() => setToolMode('select')}
              className="text-blue-600 focus:ring-blue-500"
            />
            Select tools
          </label>
        </div>
        {toolMode === 'select' && (
          <div className="space-y-1 ml-2">
            {AVAILABLE_TOOLS.map((tool) => (
              <label key={tool.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedTools.has(tool.key)}
                  onChange={() => toggleTool(tool.key)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="font-mono text-gray-700">{tool.key}</span>
                <span className="text-gray-400">({tool.label})</span>
              </label>
            ))}
          </div>
        )}
      </div>

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
