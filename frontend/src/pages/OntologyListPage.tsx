import { useEffect, useRef, useState } from 'react';
import type { Ontology } from '../types/models';
import * as api from '../api/client';
import { ApiError } from '../api/client';
import OntologyCard from '../components/OntologyCard';
import OntologyForm from '../components/forms/OntologyForm';

export default function OntologyListPage() {
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setOntologies(await api.listOntologies());
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load ontologies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data: { name: string; key?: string; description?: string }) => {
    if (!data.key) return;
    try {
      await api.createOntology({ name: data.name, key: data.key, description: data.description });
      setShowForm(false);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create ontology');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteOntology(id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete ontology');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importSchema(data);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESOURCE_CONFLICT') {
        alert(`Import conflict: ${e.message}`);
      } else {
        alert(e instanceof Error ? e.message : 'Failed to import schema');
      }
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    e.target.value = '';
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Ontologies</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onFileSelected}
            className="hidden"
          />
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : 'Create Ontology'}
          </button>
        </div>
      </div>
      {showForm && (
        <div className="mb-6 p-4 bg-white border rounded-lg">
          <OntologyForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}
      {ontologies.length === 0 ? (
        <p className="text-gray-400">No ontologies yet. Create one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ontologies.map((o) => (
            <OntologyCard key={o.ontologyId} ontology={o} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
