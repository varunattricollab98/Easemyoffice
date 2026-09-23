import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppSidebar, MobileTabBar } from "@/components/app-shell";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { NotificationsWatcher } from "@/components/notifications-watcher";
import { GlobalSearch } from "@/components/global-search";
import { GlobalSearchContext } from "@/lib/global-search-context";
import { runDailyBackupIfDue } from "@/lib/backup";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  useGlobalShortcuts();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate({ to: "/login" });
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => { if (isAuthenticated) runDailyBackupIfDue(); }, [isAuthenticated]);

  // Cmd/Ctrl+K opens the global search palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <GlobalSearchContext.Provider value={{ open: () => setSearchOpen(true) }}>
      <div className="min-h-screen flex bg-background">
        <AppSidebar />
        <main className="flex-1 min-w-0 pb-20 lg:pb-0">
          <Outlet />
        </main>
        <MobileTabBar />
        <ShortcutsOverlay />
        <NotificationsWatcher />
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </GlobalSearchContext.Provider>
  );
}
