import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumb from './Breadcrumb';
import Toast from './Toast';

export default function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 flex items-center px-6 border-b border-gray-200 shrink-0">
          <Breadcrumb />
        </div>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toast />
    </div>
  );
}
