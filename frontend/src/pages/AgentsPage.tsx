import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as api from '../api/client';
import AiAgentForm from '../components/forms/AiAgentForm';

export default function AgentsPage() {
  const { ontologyId } = useParams<{ ontologyId: string }>();

  const { data: ontology = null, isLoading: ontologyLoading } = useQuery({
    queryKey: ['ontology', ontologyId],
    queryFn: () => api.getOntology(ontologyId!),
    enabled: !!ontologyId,
  });

  const { data: aiAgents = [], refetch: refetchAgents } = useQuery({
    queryKey: ['ontology', ontology?.key, 'ai-agents'],
    queryFn: () => api.listAiAgents(ontology!.key),
    enabled: !!ontology?.key,
  });

  const [addingAgent, setAddingAgent] = useState(false);
  const [editingAgentKey, setEditingAgentKey] = useState<string | null>(null);

  const handleCreateAgent = async (data: { key: string; name: string; description?: string | null; systemPrompt?: string | null; tools?: string[] | null }) => {
    if (!ontology) return;
    try {
      await api.upsertAiAgent(ontology.key, data.key, data);
      refetchAgents();
      setAddingAgent(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create agent');
    }
  };

  const handleUpdateAgent = async (data: { key: string; name: string; description?: string | null; systemPrompt?: string | null; tools?: string[] | null }) => {
    if (!ontology) return;
    try {
      await api.upsertAiAgent(ontology.key, data.key, data);
      refetchAgents();
      setEditingAgentKey(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update agent');
    }
  };

  const handleDeleteAgent = async (agentKey: string) => {
    if (!ontology || !confirm(`Delete agent "${agentKey}"?`)) return;
    try {
      await api.deleteAiAgent(ontology.key, agentKey);
      refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete agent');
    }
  };

  if (ontologyLoading) return <p>Loading...</p>;
  if (!ontology) return <p>Ontology not found.</p>;

  return (
    <div>
      <Link to={`/ontologies/${ontologyId}`} className="text-blue-600 hover:underline text-sm">&larr; Back to scope</Link>

      <div className="mt-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">AI Agents</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ontology: <span className="font-mono">{ontology.key}</span>
        </p>
      </div>

      {aiAgents.length === 0 && !addingAgent && (
        <p className="text-gray-400 text-sm italic mb-3">No AI agents configured. The default assistant will be used.</p>
      )}

      <div className="space-y-2 mb-3">
        {aiAgents.map((agent) =>
          editingAgentKey === agent.key ? (
            <AiAgentForm
              key={agent.key}
              initial={agent}
              onSubmit={handleUpdateAgent}
              onCancel={() => setEditingAgentKey(null)}
            />
          ) : (
            <div key={agent.key} className="flex items-center justify-between bg-white border rounded-lg p-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-900 truncate">{agent.name}</span>
                <span className="text-sm text-gray-400 font-mono shrink-0">{agent.key}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                  {agent.tools === null ? 'all tools' : `${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="flex gap-2 shrink-0 ml-2">
                <button onClick={() => setEditingAgentKey(agent.key)} className="text-sm text-blue-600 hover:text-blue-800">Edit</button>
                <button onClick={() => handleDeleteAgent(agent.key)} className="text-sm text-red-600 hover:text-red-800">Delete</button>
              </div>
            </div>
          ),
        )}
      </div>

      {addingAgent ? (
        <AiAgentForm onSubmit={handleCreateAgent} onCancel={() => setAddingAgent(false)} />
      ) : (
        <button
          onClick={() => setAddingAgent(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Add agent
        </button>
      )}
    </div>
  );
}
