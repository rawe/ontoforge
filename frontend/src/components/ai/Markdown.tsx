import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  children: string;
  className?: string;
}

export default function Markdown({ children, className = '' }: MarkdownProps) {
  return (
    <div className={`text-sm ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        children={children}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-300 text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 px-3 py-1.5 text-left font-medium text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-3 py-1.5 text-gray-900">
              {children}
            </td>
          ),
          pre: ({ children }) => (
            <pre className="bg-gray-50 rounded p-3 overflow-x-auto text-xs">{children}</pre>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-');
            return isBlock ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">{children}</code>
            );
          },
        }}
      />
    </div>
  );
}
