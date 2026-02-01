import { Sidebar } from '@/components/sidebar';
import { AuthGuard } from '@/components/auth-guard';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Sidebar />
        <main className="ml-56 p-6">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
