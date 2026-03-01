import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useOntologyTree } from '../hooks/useOntologyTree';
import type { OntologyTreeNode } from '../hooks/useOntologyTree';

function getStoredCollapsed(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val === 'true';
  } catch {
    return fallback;
  }
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
    </svg>
  );
}

function NavLink({ to, label, pathname }: { to: string; label: string; pathname: string }) {
  const active = pathname === to || pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      className={`block px-3 py-1.5 text-sm rounded truncate transition-colors ${
        active
          ? 'bg-gray-700 border-l-2 border-blue-400 pl-2.5'
          : 'hover:bg-gray-800 text-gray-300'
      }`}
    >
      {label}
    </Link>
  );
}

function OntologyNode({ node, pathname }: { node: OntologyTreeNode; pathname: string }) {
  const storageKey = `sidebar-collapsed-${node.ontology.key}`;
  const [expanded, setExpanded] = useState(() => !getStoredCollapsed(storageKey, true));

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(storageKey, String(!next)); } catch { /* noop */ }
  };

  const entityTypes = node.schema?.entityTypes ?? [];
  const relationTypes = node.schema?.relationTypes ?? [];

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-800 rounded transition-colors text-left"
      >
        <ChevronIcon expanded={expanded} />
        <span className="truncate">{node.ontology.name}</span>
      </button>

      {expanded && (
        <div className="ml-3 pl-3 border-l border-gray-700 flex flex-col gap-0.5 mt-0.5">
          <NavLink to={`/ontologies/${node.ontology.ontologyId}`} label="Schema" pathname={pathname} />

          {(entityTypes.length > 0 || relationTypes.length > 0) && (
            <div className="mt-1">
              <span className="px-3 text-xs font-semibold uppercase text-gray-500 tracking-wider">Data</span>
              <div className="flex flex-col gap-0.5 mt-1">
                {entityTypes.length > 0 && (
                  <>
                    <span className="px-3 text-xs uppercase text-gray-500 tracking-wider">Entities</span>
                    {entityTypes.map((et) => (
                      <NavLink
                        key={et.key}
                        to={`/data/${node.ontology.key}/entities/${et.key}`}
                        label={et.displayName}
                        pathname={pathname}
                      />
                    ))}
                  </>
                )}
                {relationTypes.length > 0 && (
                  <>
                    <span className="px-3 text-xs uppercase text-gray-500 tracking-wider mt-1">Relations</span>
                    {relationTypes.map((rt) => (
                      <NavLink
                        key={rt.key}
                        to={`/data/${node.ontology.key}/relations/${rt.key}`}
                        label={rt.displayName}
                        pathname={pathname}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { ontologies, isLoading } = useOntologyTree();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => getStoredCollapsed('sidebar-collapsed', false));

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('sidebar-collapsed', String(next)); } catch { /* noop */ }
  };

  return (
    <aside
      className={`bg-gray-900 text-white flex flex-col transition-all ${
        collapsed ? 'w-12' : 'w-56'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center p-4 ${collapsed ? 'justify-center' : ''}`}>
        <Link to="/ontologies" className="text-xl font-bold hover:opacity-80 transition-opacity">
          {collapsed ? 'O' : 'OntoForge'}
        </Link>
      </div>

      {/* Tree */}
      {!collapsed && (
        <nav className="flex-1 overflow-y-auto px-2 flex flex-col gap-1">
          {isLoading && (
            <p className="px-3 text-sm text-gray-400">Loading...</p>
          )}
          {ontologies.map((node) => (
            <OntologyNode key={node.ontology.ontologyId} node={node} pathname={pathname} />
          ))}
          {!isLoading && ontologies.length === 0 && (
            <p className="px-3 text-sm text-gray-500">No ontologies</p>
          )}
        </nav>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleCollapsed}
        className="p-3 hover:bg-gray-800 transition-colors flex justify-center"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ExpandIcon /> : <CollapseIcon />}
      </button>
    </aside>
  );
}
