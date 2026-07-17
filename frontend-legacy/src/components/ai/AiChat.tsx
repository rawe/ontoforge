import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { aiChat, aiAgentChat } from '../../api/runtimeClient';
import type { AiChatMessage } from '../../types/runtime';
import { useAiState } from '../../hooks/useAiState';
import Markdown from './Markdown';

interface AiChatProps {
  ontologyKey: string;
  agentKey?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="tabular-nums text-gray-400 text-xs ml-2">
      {formatDuration(elapsed)}
    </span>
  );
}

export default function AiChat({ ontologyKey, agentKey = '_default' }: AiChatProps) {
  const { getState, updateChat } = useAiState();
  const { messages, input } = getState(ontologyKey).chat;
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const setInput = (v: string) => updateChat(ontologyKey, { input: v });

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

    const startTime = Date.now();

    try {
      const history: AiChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = agentKey === '_default'
        ? await aiChat(ontologyKey, userMessage, history.length > 0 ? history : undefined)
        : await aiAgentChat(ontologyKey, agentKey, userMessage, history.length > 0 ? history : undefined);

      const durationMs = Date.now() - startTime;

      updateChat(ontologyKey, {
        messages: [
          ...updatedMessages,
          {
            role: 'assistant',
            content: res.reply,
            toolCalls: res.toolCalls ?? undefined,
            durationMs,
          },
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat failed';
      toast.error(msg);
      const durationMs = Date.now() - startTime;
      updateChat(ontologyKey, {
        messages: [
          ...updatedMessages,
          { role: 'assistant', content: `Error: ${msg}`, durationMs },
        ],
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

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Message bubble */}
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

            {/* Tool calls + duration info for assistant messages */}
            {msg.role === 'assistant' && (
              <div className="flex items-center gap-2 mt-1 ml-1">
                {/* Tool calls pill */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <button
                    onClick={() => toggleToolExpand(i)}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] transition-colors ${
                      expandedTools.has(i)
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {msg.toolCalls.length} tool{msg.toolCalls.length > 1 ? 's' : ''} used
                    {msg.durationMs != null && (
                      <span className="text-gray-400 ml-0.5">· {formatDuration(msg.durationMs)}</span>
                    )}
                    <svg
                      className={`w-3 h-3 transition-transform ${expandedTools.has(i) ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
                {/* Duration only (no tools) */}
                {(!msg.toolCalls || msg.toolCalls.length === 0) && msg.durationMs != null && (
                  <span className="text-[11px] text-gray-400 tabular-nums">
                    {formatDuration(msg.durationMs)}
                  </span>
                )}
              </div>
            )}

            {/* Expanded tool calls */}
            {expandedTools.has(i) && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="ml-2 mt-1.5 space-y-1">
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
        ))}

        {/* Loading indicator with live timer */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 px-3 py-2 rounded-lg text-sm inline-flex items-center">
              <span className="inline-flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDuration: '1s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDuration: '1s', animationDelay: '0.15s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDuration: '1s', animationDelay: '0.3s' }} />
              </span>
              <ElapsedTimer />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 pt-3">
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
