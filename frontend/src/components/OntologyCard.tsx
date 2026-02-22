import { Link } from 'react-router-dom';
import type { Ontology } from '../types/models';

interface Props {
  ontology: Ontology;
  onDelete: (id: string) => void;
}

export default function OntologyCard({ ontology, onDelete }: Props) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <Link to={`/ontologies/${ontology.ontologyId}`} className="block">
        <h3 className="text-lg font-semibold text-gray-900">
          {ontology.name}
          <span className="ml-2 text-sm text-gray-400 font-mono font-normal">{ontology.key}</span>
        </h3>
        <p className="text-sm text-gray-500 mt-1">{ontology.description || 'No description'}</p>
        <p className="text-xs text-gray-400 mt-2">Updated {new Date(ontology.updatedAt).toLocaleDateString()}</p>
      </Link>
      <div className="mt-3 flex gap-3">
        <Link to={`/data/${ontology.key}`} className="text-sm text-purple-600 hover:text-purple-800">
          Data
        </Link>
        <button
          onClick={() => { if (confirm('Delete this ontology?')) onDelete(ontology.ontologyId); }}
          className="text-sm text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
