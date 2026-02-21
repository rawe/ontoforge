import { Link, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-gray-900 text-white flex flex-col p-4">
        <h1 className="text-xl font-bold mb-6">OntoForge</h1>
        <nav className="flex flex-col gap-2">
          <Link to="/ontologies" className="px-3 py-2 rounded hover:bg-gray-700 transition-colors">
            Ontologies
          </Link>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
