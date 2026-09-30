import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, Clock, CalendarDays, Plus, Trash2, Settings2, Crosshair } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/utils";
import {
  hrmsDb,
  formatMinutes,
  lateAfter,
  WEEKDAYS,
  HOLIDAY_TYPES,
  type HrSettings,
  type Holiday,
  type OfficeLocation,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/hrms/settings")({
  head: () => ({ meta: [{ title: "Office & Hours — EaseMyOffice CRM" }] }),
  // Admin guard lives on the /hrms layout route.
  component: HrSettingsPage,
});

function HrSettingsPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" /> Office &amp; Hours
        </h2>
        <p className="text-sm text-muted-foreground">
          Office location, working hours, weekly offs and holidays. Attendance reads all of its
          rules from here.
        </p>
      </div>
      <OfficeCard />
      <WorkingHoursCard />
      <HolidaysCard />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OfficeCard() {
  const qc = useQueryClient();
  const [f, setF] = useState({
    id: "",
    name: "",
    latitude: "",
    longitude: "",
    radius_m: "100",
    max_accuracy_m: "50",
  });
  const [locating, setLocating] = useState(false);

  const { data: offices = [] } = useQuery({
    queryKey: ["hrms-offices"],
    queryFn: async (): Promise<OfficeLocation[]> => {
      const { data } = await hrmsDb().from("office_locations").select("*").order("name");
      return data ?? [];
    },
  });

  // Phase 1 configures a single office; the table supports more for later.
  const office = offices[0];
  useEffect(() => {
    if (!office) return;
    setF({
      id: office.id,
      name: office.name,
      latitude: String(office.latitude),
      longitude: String(office.longitude),
      radius_m: String(office.radius_m),
      max_accuracy_m: String(office.max_accuracy_m),
    });
  }, [office]);

  /**
   * Fills the coordinates from the browser's current position — the intended way
   * to set this up is to stand in the office and press it, which avoids
   * transcribing coordinates from a map by hand.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This browser cannot report a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setF((s) => ({
          ...s,
          latitude: pos.coords.latitude.toFixed(7),
          longitude: pos.coords.longitude.toFixed(7),
        }));
        toast.success(`Captured · accuracy ±${Math.round(pos.coords.accuracy)}m`);
      },
      (err) => {
        setLocating(false);
        toast.error(err.message || "Could not read location");
      },
      // No cached fix: a stale position from another place would silently anchor
      // the geofence to the wrong spot.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Office name is required");
      const lat = Number(f.latitude);
      const lng = Number(f.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        throw new Error("Valid coordinates are required");
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
        throw new Error("Coordinates are out of range");
      const row = {
        name: f.name.trim(),
        latitude: lat,
        longitude: lng,
        radius_m: Math.max(20, Number(f.radius_m) || 100),
        max_accuracy_m: Math.max(10, Number(f.max_accuracy_m) || 50),
        active: true,
      };
      const { error } = f.id
        ? await hrmsDb().from("office_locations").update(row).eq("id", f.id)
        : await hrmsDb().from("office_locations").insert(row);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Office location saved");
      qc.invalidateQueries({ queryKey: ["hrms-offices"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Office location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label className="text-xs">Office Name</Label>
            <Input
              value={f.name}
              placeholder="EaseMyOffice HQ"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Latitude</Label>
            <Input
              value={f.latitude}
              inputMode="decimal"
              onChange={(e) => setF({ ...f, latitude: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Longitude</Label>
            <Input
              value={f.longitude}
              inputMode="decimal"
              onChange={(e) => setF({ ...f, longitude: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              disabled={locating}
              onClick={useMyLocation}
            >
              <Crosshair className="h-4 w-4 mr-1" />
              {locating ? "Locating…" : "Use my location"}
            </Button>
          </div>
          <div>
            <Label className="text-xs">Allowed radius (metres)</Label>
            <Input
              type="number"
              min={20}
              value={f.radius_m}
              onChange={(e) => setF({ ...f, radius_m: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Max GPS accuracy (metres)</Label>
            <Input
              type="number"
              min={10}
              value={f.max_accuracy_m}
              onChange={(e) => setF({ ...f, max_accuracy_m: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A login is accepted when the reported position is within the radius <em>and</em> the
          reading is at least as precise as the accuracy limit. Rejecting vague readings matters: a
          fix accurate to 2km that happens to centre on the office proves nothing about where the
          phone actually is.
        </p>
        <div className="flex justify-end">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save office"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function WorkingHoursCard() {
  const qc = useQueryClient();
  const [f, setF] = useState({
    work_start: "09:30",
    grace_minutes: "15",
    required_minutes: "510",
    half_day_minutes: "240",
    week_offs: [0, 6] as number[],
    require_geofence: true,
    require_device_approval: false,
  });

  const { data: settings } = useQuery({
    queryKey: ["hrms-settings"],
    queryFn: async (): Promise<HrSettings | null> => {
      const { data } = await hrmsDb().from("hr_settings").select("*").maybeSingle();
      return data ?? null;
    },
  });

  useEffect(() => {
    if (!settings) return;
    setF({
      // Postgres returns time as "09:30:00"; the input wants "09:30".
      work_start: String(settings.work_start ?? "09:30").slice(0, 5),
      grace_minutes: String(settings.grace_minutes ?? 15),
      required_minutes: String(settings.required_minutes ?? 510),
      half_day_minutes: String(settings.half_day_minutes ?? 240),
      week_offs: settings.week_offs ?? [0, 6],
      require_geofence: settings.require_geofence ?? true,
      require_device_approval: settings.require_device_approval ?? false,
    });
  }, [settings]);

  const toggleDay = (d: number) =>
    setF((s) => ({
      ...s,
      week_offs: s.week_offs.includes(d)
        ? s.week_offs.filter((x) => x !== d)
        : [...s.week_offs, d].sort(),
    }));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await hrmsDb()
        .from("hr_settings")
        .update({
          work_start: f.work_start,
          grace_minutes: Number(f.grace_minutes) || 0,
          required_minutes: Number(f.required_minutes) || 510,
          half_day_minutes: Number(f.half_day_minutes) || 240,
          week_offs: f.week_offs,
          require_geofence: f.require_geofence,
          require_device_approval: f.require_device_approval,
        })
        .eq("id", true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Working hours saved");
      qc.invalidateQueries({ queryKey: ["hrms-settings"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> Working hours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Office start</Label>
            <Input
              type="time"
              value={f.work_start}
              onChange={(e) => setF({ ...f, work_start: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Grace period (minutes)</Label>
            <Input
              type="number"
              min={0}
              value={f.grace_minutes}
              onChange={(e) => setF({ ...f, grace_minutes: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Full day (minutes)</Label>
            <Input
              type="number"
              min={60}
              value={f.required_minutes}
              onChange={(e) => setF({ ...f, required_minutes: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatMinutes(Number(f.required_minutes) || 0)}
            </p>
          </div>
          <div>
            <Label className="text-xs">Half day after (minutes)</Label>
            <Input
              type="number"
              min={30}
              value={f.half_day_minutes}
              onChange={(e) => setF({ ...f, half_day_minutes: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatMinutes(Number(f.half_day_minutes) || 0)}
            </p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-3 text-xs">
          Anyone logging in after{" "}
          <strong className="text-foreground">
            {lateAfter(f.work_start, Number(f.grace_minutes) || 0)}
          </strong>{" "}
          is marked present <em>and</em> late.
        </div>

        <div>
          <Label className="text-xs">Weekly offs</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const off = f.week_offs.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDay(d.id)}
                  aria-pressed={off}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 ${
                    off
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Highlighted days are non-working and are excluded from the working-day count.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="text-xs">
            <div className="font-medium text-foreground">Require office geofence</div>
            <div className="text-muted-foreground">
              When off, attendance is accepted from anywhere. Useful while testing the rollout.
            </div>
          </div>
          <Button
            size="sm"
            variant={f.require_geofence ? "default" : "outline"}
            onClick={() => setF({ ...f, require_geofence: !f.require_geofence })}
          >
            {f.require_geofence ? "On" : "Off"}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="text-xs">
            <div className="font-medium text-foreground">Require device approval</div>
            <div className="text-muted-foreground">
              When on, a phone or browser used for the first time cannot punch until the admin
              approves it under Attendance → Devices.
            </div>
          </div>
          <Button
            size="sm"
            variant={f.require_device_approval ? "default" : "outline"}
            onClick={() => setF({ ...f, require_device_approval: !f.require_device_approval })}
          >
            {f.require_device_approval ? "On" : "Off"}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save working hours"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function HolidaysCard() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", date: "", holiday_type: "company" });
  const year = new Date().getFullYear();

  const { data: holidays = [] } = useQuery({
    queryKey: ["hrms-holidays", year],
    queryFn: async (): Promise<Holiday[]> => {
      const { data } = await hrmsDb()
        .from("holidays")
        .select("*")
        .gte("date", `${year}-01-01`)
        .lte("date", `${year}-12-31`)
        .order("date");
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Holiday name is required");
      if (!f.date) throw new Error("Date is required");
      const { error } = await hrmsDb()
        .from("holidays")
        .insert({ name: f.name.trim(), date: f.date, holiday_type: f.holiday_type });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Holiday added");
      setF({ name: "", date: "", holiday_type: "company" });
      qc.invalidateQueries({ queryKey: ["hrms-holidays", year] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await hrmsDb().from("holidays").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Holiday removed");
      qc.invalidateQueries({ queryKey: ["hrms-holidays", year] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" /> Holidays {year}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_170px_190px_auto]">
          <div>
            <Label className="text-xs">Holiday name</Label>
            <Input
              value={f.name}
              placeholder="Diwali"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={f.holiday_type} onValueChange={(v) => setF({ ...f, holiday_type: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLIDAY_TYPES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button disabled={add.isPending} onClick={() => add.mutate()}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>

        {holidays.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No holidays added for {year} yet.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-3 py-2">
                <div className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {format(new Date(h.date), "d MMM, EEE")}
                </div>
                <div className="min-w-0 flex-1 truncate text-sm font-medium">{h.name}</div>
                <Badge variant="secondary" className="text-[11px]">
                  {HOLIDAY_TYPES.find((t) => t.id === h.holiday_type)?.label ?? h.holiday_type}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => remove.mutate(h.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
