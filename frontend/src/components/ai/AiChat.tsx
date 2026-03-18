import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { aiChat } from '../../api/runtimeClient';
import type { AiChatMessage } from '../../types/runtime';
import { useAiState } from '../../hooks/useAiState';
import Markdown from './Markdown';

interface AiChatProps {
  ontologyKey: string;
}

export default function AiChat({ ontologyKey }: AiChatProps) {
  const { getState, updateChat, resetChat } = useAiState();
  const { messages, input, showToolCalls } = getState(ontologyKey).chat;
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const setInput = (v: string) => updateChat(ontologyKey, { input: v });
  const setShowToolCalls = (v: boolean) => updateChat(ontologyKey, { showToolCalls: v });

  const toggleToolExpand = (index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    const updatedMessages = [...messages, { role: 'user' as const, content: userMessage }];
    updateChat(ontologyKey, { messages: updatedMessages, input: '' });
    setLoading(true);

    try {
      const history: AiChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await aiChat(ontologyKey, userMessage, history.length > 0 ? history : undefined, showToolCalls);
      updateChat(ontologyKey, {
        messages: [...updatedMessages, { role: 'assistant', content: res.reply, toolCalls: res.toolCalls ?? undefined }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat failed';
      toast.error(msg);
      updateChat(ontologyKey, {
        messages: [...updatedMessages, { role: 'assistant', content: `Error: ${msg}` }],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleReset = () => {
    if (loading) return;
    resetChat(ontologyKey);
    setExpandedTools(new Set());
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.length === 0 && !loading && (
          <p className="text-sm text-gray-400 italic text-center mt-8">
            Start a conversation about your data...
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white whitespace-pre-wrap'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <Markdown>{msg.content}</Markdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>

            {showToolCalls && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="ml-2 mt-1">
                <button
                  onClick={() => toggleToolExpand(i)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  {expandedTools.has(i) ? 'Hide' : 'Show'} {msg.toolCalls.length} tool call{msg.toolCalls.length > 1 ? 's' : ''}
                </button>
                {expandedTools.has(i) && (
                  <div className="mt-1 space-y-1">
                    {msg.toolCalls.map((tc, j) => (
                      <div key={j} className="text-xs bg-gray-50 border border-gray-200 rounded p-2">
                        <span className="font-mono font-medium text-purple-700">{tc.tool}</span>
                        <pre className="mt-1 text-gray-600 overflow-x-auto">
                          {JSON.stringify(tc.args, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 px-3 py-2 rounded-lg text-sm">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center gap-3 mb-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={showToolCalls}
              onChange={(e) => setShowToolCalls(e.target.checked)}
              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            Show tool calls
          </label>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              New conversation
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
