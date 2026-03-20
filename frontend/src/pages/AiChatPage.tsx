import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFeatures } from '../hooks/useFeatures';
import { listAgents } from '../api/runtimeClient';
import { useAiState } from '../hooks/useAiState';
import AiChat from '../components/ai/AiChat';

export default function AiChatPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: features } = useFeatures();
  const { getState, updateChat } = useAiState();

  const { data: agents = [] } = useQuery({
    queryKey: ['runtime', ontologyKey, 'agents'],
    queryFn: () => listAgents(ontologyKey!),
    enabled: !!ontologyKey,
  });

  if (!ontologyKey) return null;

  const chatState = getState(ontologyKey).chat;
  const selectedAgent = agents.find((a) => a.key === chatState.agentKey);

  const handleAgentChange = (agentKey: string) => {
    updateChat(ontologyKey, { agentKey, messages: [] });
  };

  if (features && !features.ai) {
    return (
      <div>
        <Link to={`/data/${ontologyKey}`} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to dashboard
        </Link>
        <p className="mt-4 text-gray-500">AI features are not enabled. Set AI_PROVIDER to enable.</p>
      </div>
    );
  }

  return (
    <div>
      <Link to={`/data/${ontologyKey}`} className="text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to dashboard
      </Link>
      <div className="flex items-center gap-3 mt-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900">AI Chat</h2>
        {agents.length > 1 && (
          <select
            value={chatState.agentKey}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {agents.map((agent) => (
              <option key={agent.key} value={agent.key}>
                {agent.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {selectedAgent && selectedAgent.key !== '_default' && selectedAgent.description && (
        <p className="text-sm text-gray-500 mb-3">{selectedAgent.description}</p>
      )}
      <AiChat ontologyKey={ontologyKey} agentKey={chatState.agentKey} />
    </div>
  );
}
