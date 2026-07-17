import { useParams, Link } from 'react-router-dom';
import { useFeatures } from '../hooks/useFeatures';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import AiExtract from '../components/ai/AiExtract';

export default function AiExtractPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: features } = useFeatures();
  const { data: schema, isLoading, error } = useRuntimeSchema(ontologyKey);

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

  if (isLoading) return <p>Loading schema...</p>;
  if (error) return <p className="text-red-600">Error: {error.message}</p>;
  if (!schema) return null;

  return (
    <div>
      <Link to={`/data/${ontologyKey}`} className="text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to dashboard
      </Link>
      <h2 className="text-xl font-bold text-gray-900 mt-3 mb-4">AI Extract</h2>
      <AiExtract ontologyKey={ontologyKey} entityTypes={schema.entityTypes} />
    </div>
  );
}
