import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFeatures } from '../hooks/useFeatures';
import { listAgents } from '../api/runtimeClient';
import { useAiState } from '../hooks/useAiState';
import AiChat from '../components/ai/AiChat';

export default function AiChatPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: features } = useFeatures();
  const { getState, updateChat, resetChat } = useAiState();

  const { data: agents = [] } = useQuery({
    queryKey: ['runtime', ontologyKey, 'agents'],
    queryFn: () => listAgents(ontologyKey!),
    enabled: !!ontologyKey,
  });

  if (!ontologyKey) return null;

  const chatState = getState(ontologyKey).chat;
  const selectedAgent = agents.find((a) => a.key === chatState.agentKey);
  const hasMessages = chatState.messages.length > 0;

  const handleAgentSelect = (agentKey: string) => {
    updateChat(ontologyKey, { agentKey, messages: [] });
  };

  const handleNewConversation = () => {
    resetChat(ontologyKey);
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

      {/* Header with agent label and new conversation button */}
      <div className="flex items-center gap-3 mt-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900">AI Chat</h2>
        {hasMessages && selectedAgent && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            {selectedAgent.name}
          </span>
        )}
        <div className="flex-1" />
        {hasMessages && (
          <button
            type="button"
            onClick={handleNewConversation}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            New conversation
          </button>
        )}
      </div>

      {/* Welcome screen when no messages */}
      {!hasMessages ? (
        <div className={`flex flex-col items-center ${agents.length > 1 ? 'pt-12' : 'pt-4'}`}>
          <div className="text-center mb-4">
            <h3 className="text-lg font-semibold text-gray-700 mb-1">Start a conversation</h3>
            <p className="text-sm text-gray-400">Ask questions about your data, explore relationships, or run queries.</p>
          </div>

          {/* Agent selector list — only when multiple agents */}
          {agents.length > 1 && (
            <div className="w-full max-w-md mb-8">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Choose an assistant</p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                {agents.map((agent) => (
                  <button
                    key={agent.key}
                    onClick={() => handleAgentSelect(agent.key)}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-purple-50 group ${
                      chatState.agentKey === agent.key
                        ? 'bg-purple-50 border-l-2 border-l-purple-500'
                        : 'border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        chatState.agentKey === agent.key ? 'text-purple-700' : 'text-gray-800 group-hover:text-purple-700'
                      }`}>
                        {agent.name}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {agent.key}
                      </span>
                      {chatState.agentKey === agent.key && (
                        <svg className="w-3.5 h-3.5 text-purple-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    {agent.description && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{agent.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Single agent — just show context label */}
          {agents.length === 1 && (
            <div className="mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                {agents[0].name}
              </span>
            </div>
          )}
        </div>
      ) : null}

      <AiChat ontologyKey={ontologyKey} agentKey={chatState.agentKey} />
    </div>
  );
}
