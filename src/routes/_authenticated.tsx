import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppSidebar, MobileTabBar } from "@/components/app-shell";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { runDailyBackupIfDue } from "@/lib/backup";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  useGlobalShortcuts();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate({ to: "/login" });
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => { if (isAuthenticated) runDailyBackupIfDue(); }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar />
      <main className="flex-1 min-w-0 pb-20 lg:pb-0">
        <Outlet />
      </main>
      <MobileTabBar />
      <ShortcutsOverlay />
    </div>
  );
}
