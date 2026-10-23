import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readPosition, type Fix } from "@/lib/attendance-client";
import {
  detectBrowser,
  detectPlatform,
  locationPermission,
  locationProblem,
  locationSteps,
  onLocationPermissionChange,
  type LocationProblem,
} from "@/lib/location-access";

const TITLES: Record<LocationProblem, string> = {
  in_app_browser: "Open the CRM in your browser",
  blocked_in_browser: "Allow location to mark attendance",
  off_in_device: "Turn on location",
  timeout: "Could not find your location",
  unsupported: "Location not available in this browser",
};

type Pending = { resolve: (fix: Fix | null) => void; problem: LocationProblem; lastFix: Fix };

/**
 * Gets a GPS fix before a punch. If location is off or blocked, opens a dialog
 * with the steps for this device and retries (also automatically when the
 * browser permission flips to Allow). Resolves with:
 *  - a good fix,
 *  - the failed fix when the user chooses "Continue without location"
 *    (the server then decides, e.g. offers a work-from-home request),
 *  - null when the user cancels.
 */
export function useLocationGate() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const finish = useCallback((fix: Fix | null) => {
    pendingRef.current?.resolve(fix);
    setPending(null);
    setBusy(false);
  }, []);

  const attempt = useCallback(async () => {
    setBusy(true);
    const fix = await readPosition();
    if (fix.ok) {
      finish(fix);
      return;
    }
    const problem = locationProblem(fix.error, await locationPermission());
    setBusy(false);
    setPending((p) => (p ? { ...p, problem, lastFix: fix } : p));
  }, [finish]);

  const getFix = useCallback(async (): Promise<Fix | null> => {
    // readPosition shows the browser's own Allow popup when not decided yet.
    const fix = await readPosition();
    if (fix.ok) return fix;
    const problem = locationProblem(fix.error, await locationPermission());
    return new Promise<Fix | null>((resolve) => setPending({ resolve, problem, lastFix: fix }));
  }, []);

  // Retry by itself the moment the user allows location for the site.
  useEffect(() => {
    if (!pending) return;
    return onLocationPermissionChange((state) => {
      if (state === "granted") void attempt();
    });
  }, [pending, attempt]);

  const platform = detectPlatform();
  const browser = detectBrowser();

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="sm:max-w-md">
        {pending && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                {TITLES[pending.problem]}
              </DialogTitle>
              <DialogDescription>
                Attendance needs your current location to confirm you are at the office.
              </DialogDescription>
            </DialogHeader>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {locationSteps(pending.problem, platform, browser).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => finish(pending.lastFix)}
                disabled={busy}
              >
                Continue without location
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => finish(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={() => void attempt()} disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {busy ? "Checking…" : "Try again"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { getFix, dialog };
}
