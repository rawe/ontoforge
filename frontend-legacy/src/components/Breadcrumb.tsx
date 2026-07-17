import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Ontology, EntityType, RelationType } from '../types/models';
import type { RuntimeSchema } from '../types/runtime';

interface Crumb {
  label: string;
  to?: string;
}

export default function Breadcrumb() {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const crumbs = buildCrumbs(pathname, queryClient);

  if (crumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm mb-4">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-400">/</span>}
            {isLast || !crumb.to ? (
              <span className="text-gray-900 font-medium">{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="text-gray-500 hover:text-gray-700 transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function buildCrumbs(pathname: string, queryClient: ReturnType<typeof useQueryClient>): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);

  // /schema
  if (parts[0] === 'schema') {
    const crumbs: Crumb[] = [{ label: 'Schema', to: '/schema' }];

    if (parts.length >= 3) {
      const typeSegment = parts[1]; // 'entity-types' or 'relation-types'
      const typeId = parts[2];
      const typeName = resolveGlobalTypeName(queryClient, typeSegment, typeId);
      crumbs.push({ label: typeName });
    }

    return crumbs;
  }

  // /ontologies
  if (parts[0] === 'ontologies') {
    const crumbs: Crumb[] = [{ label: 'Ontologies', to: '/ontologies' }];

    if (parts.length >= 2) {
      const ontologyId = parts[1];
      const ontologyName = resolveOntologyName(queryClient, ontologyId);

      if (parts.length === 2) {
        crumbs.push({ label: ontologyName });
      } else {
        crumbs.push({ label: ontologyName, to: `/ontologies/${ontologyId}` });
        if (parts[2] === 'agents') crumbs.push({ label: 'AI Agents' });
        else if (parts[2] === 'saved-queries') crumbs.push({ label: 'Saved Queries' });
      }
    }

    return crumbs;
  }

  // /data/:key/...
  if (parts[0] === 'data') {
    const ontologyKey = parts[1];
    const ontologyName = resolveOntologyNameByKey(queryClient, ontologyKey);
    const crumbs: Crumb[] = [
      { label: ontologyName, to: `/data/${ontologyKey}` },
      { label: 'Data', to: `/data/${ontologyKey}` },
    ];

    if (parts[2] === 'graph') {
      crumbs.push({ label: 'Visual Editor' });
    } else if (parts[2] === 'ai' && parts[3]) {
      const aiLabels: Record<string, string> = { query: 'AI Query', extract: 'AI Extract', chat: 'AI Chat' };
      crumbs.push({ label: aiLabels[parts[3]] ?? parts[3] });
    } else if ((parts[2] === 'entities' || parts[2] === 'relations') && parts.length === 3) {
      crumbs.push({ label: parts[2] === 'entities' ? 'Entities' : 'Relations' });
    } else if (parts.length >= 4) {
      const typeSegment = parts[2]; // 'entities' or 'relations'
      const typeKey = parts[3];
      const typeName = resolveRuntimeTypeName(queryClient, ontologyKey, typeSegment, typeKey);
      crumbs.push({ label: typeSegment === 'entities' ? 'Entities' : 'Relations', to: `/data/${ontologyKey}/${typeSegment}` });
      crumbs.push({ label: typeName });
    }

    return crumbs;
  }

  return [];
}

function resolveOntologyName(queryClient: ReturnType<typeof useQueryClient>, ontologyId: string): string {
  const ontologies = queryClient.getQueryData<Ontology[]>(['ontologies']);
  const ontology = ontologies?.find((o) => o.ontologyId === ontologyId);
  return ontology?.name ?? ontologyId;
}

function resolveOntologyNameByKey(queryClient: ReturnType<typeof useQueryClient>, key: string): string {
  const ontologies = queryClient.getQueryData<Ontology[]>(['ontologies']);
  const ontology = ontologies?.find((o) => o.key === key);
  return ontology?.name ?? key;
}

function resolveGlobalTypeName(
  queryClient: ReturnType<typeof useQueryClient>,
  typeSegment: string,
  typeId: string,
): string {
  if (typeSegment === 'entity-types') {
    const types = queryClient.getQueryData<EntityType[]>(['entityTypes']);
    const et = types?.find((t) => t.entityTypeId === typeId);
    return et?.displayName ?? typeId;
  }
  if (typeSegment === 'relation-types') {
    const types = queryClient.getQueryData<RelationType[]>(['relationTypes']);
    const rt = types?.find((t) => t.relationTypeId === typeId);
    return rt?.displayName ?? typeId;
  }
  return typeId;
}

function resolveRuntimeTypeName(
  queryClient: ReturnType<typeof useQueryClient>,
  ontologyKey: string,
  typeSegment: string,
  typeKey: string,
): string {
  const schema = queryClient.getQueryData<RuntimeSchema>(['schema', ontologyKey]);
  if (!schema) return typeKey;

  if (typeSegment === 'entities') {
    const et = schema.entityTypes.find((t) => t.key === typeKey);
    return et?.displayName ?? typeKey;
  }
  if (typeSegment === 'relations') {
    const rt = schema.relationTypes.find((t) => t.key === typeKey);
    return rt?.displayName ?? typeKey;
  }
  return typeKey;
}
