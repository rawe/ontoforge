import { useParams, Link } from 'react-router-dom';
import { useFeatures } from '../hooks/useFeatures';
import AiQuery from '../components/ai/AiQuery';

export default function AiQueryPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: features } = useFeatures();

  if (!ontologyKey) return null;

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
      <h2 className="text-xl font-bold text-gray-900 mt-3 mb-4">AI Query</h2>
      <AiQuery ontologyKey={ontologyKey} />
    </div>
  );
}
