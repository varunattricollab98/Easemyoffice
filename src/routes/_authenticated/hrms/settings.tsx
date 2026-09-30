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
import {
  MapPin,
  Clock,
  CalendarDays,
  Plus,
  Trash2,
  Settings2,
  Crosshair,
  Eye,
  EyeOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/utils";
import {
  hrmsDb,
  formatMinutes,
  WEEKDAYS,
  HOLIDAY_TYPES,
  type HrSettings,
  type Holiday,
  type OfficeLocation,
} from "@/lib/hrms";
import {
  normalizeSchedules,
  timeToMinutes,
  DEFAULT_SCHEDULES,
  type DaySchedule,
  type ScheduleMode,
} from "@/lib/attendance-rules";
import { describeSchedule } from "@/lib/attendance-queries";

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
          Office location, weekly schedule, leave policy and holidays. Attendance reads all of its
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

type ScheduleDraft = { mode: ScheduleMode; start: string; end: string; required: string };

function WorkingHoursCard() {
  const qc = useQueryClient();
  const [days, setDays] = useState<ScheduleDraft[]>(() => toDraft(DEFAULT_SCHEDULES));
  const [f, setF] = useState({
    grace_minutes: "15",
    half_day_minutes: "240",
    idle_threshold_minutes: "60",
    monthly_leave_quota: "2",
    leave_carry_cap: "1",
    leave_policy_start: "2026-10-01",
    require_geofence: true,
    require_device_approval: false,
    allow_remote_requests: true,
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
    setDays(toDraft(normalizeSchedules(settings.day_schedules)));
    setF({
      grace_minutes: String(settings.grace_minutes ?? 15),
      half_day_minutes: String(settings.half_day_minutes ?? 240),
      idle_threshold_minutes: String(settings.idle_threshold_minutes ?? 60),
      monthly_leave_quota: String(settings.monthly_leave_quota ?? 2),
      leave_carry_cap: String(settings.leave_carry_cap ?? 1),
      leave_policy_start: String(settings.leave_policy_start ?? "2026-10-01").slice(0, 10),
      require_geofence: settings.require_geofence ?? true,
      require_device_approval: settings.require_device_approval ?? false,
      allow_remote_requests: settings.allow_remote_requests ?? true,
    });
  }, [settings]);

  // The day-by-day grid is long and rarely edited, so it starts collapsed
  // behind a one-line summary.
  const [showDays, setShowDays] = useState(false);

  const setDay = (i: number, patch: Partial<ScheduleDraft>) =>
    setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = useMutation({
    mutationFn: async () => {
      const schedules = normalizeSchedules(
        days.map((d) => ({
          mode: d.mode,
          start: d.start,
          end: d.end,
          required_minutes: Math.round(Number(d.required) * 60),
        })),
      );
      for (const [i, d] of schedules.entries()) {
        if (d.mode !== "off" && timeToMinutes(d.end) <= timeToMinutes(d.start))
          throw new Error(`${WEEKDAYS[i].label}: end time must be after start time`);
      }
      const { error } = await hrmsDb()
        .from("hr_settings")
        .update({
          day_schedules: schedules,
          // Legacy column kept in sync for anything still reading it.
          week_offs: schedules.flatMap((d, i) => (d.mode === "off" ? [i] : [])),
          grace_minutes: Math.max(0, Number(f.grace_minutes) || 0),
          half_day_minutes: Math.max(30, Number(f.half_day_minutes) || 240),
          idle_threshold_minutes: Math.max(10, Number(f.idle_threshold_minutes) || 60),
          monthly_leave_quota: Math.max(0, Number(f.monthly_leave_quota) || 0),
          leave_carry_cap: Math.max(0, Number(f.leave_carry_cap) || 0),
          leave_policy_start: f.leave_policy_start || "2026-10-01",
          require_geofence: f.require_geofence,
          require_device_approval: f.require_device_approval,
          allow_remote_requests: f.allow_remote_requests,
        })
        .eq("id", true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Working hours and policy saved");
      qc.invalidateQueries({ queryKey: ["hrms-settings"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  const toggles: {
    key: "require_geofence" | "require_device_approval" | "allow_remote_requests";
    title: string;
    hint: string;
  }[] = [
    {
      key: "require_geofence",
      title: "Require office geofence",
      hint: "When off, attendance is accepted from anywhere. Useful while testing the rollout.",
    },
    {
      key: "allow_remote_requests",
      title: "Allow work-from-home requests",
      hint: "Outside the office, employees can log in as work from home. You get an email and approve the day under Approvals.",
    },
    {
      key: "require_device_approval",
      title: "Require device approval",
      hint: "When on, a phone or browser used for the first time cannot punch until you approve it under Attendance → Devices.",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> Weekly schedule
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showDays}
          onClick={() => setShowDays((v) => !v)}
        >
          {showDays ? (
            <>
              <EyeOff className="h-4 w-4 mr-1" /> Hide
            </>
          ) : (
            <>
              <Eye className="h-4 w-4 mr-1" /> View
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showDays && (
          <button
            type="button"
            onClick={() => setShowDays(true)}
            className="flex w-full flex-wrap gap-2 rounded-lg border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
          >
            {scheduleSummary(days).map((g) => (
              <span
                key={g.days}
                className="rounded-full border bg-background px-3 py-1 text-xs shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              >
                <span className="font-semibold">{g.days}</span>
                <span className="text-muted-foreground"> · {g.rule}</span>
              </span>
            ))}
          </button>
        )}
        {showDays && (
          <>
            <div className="divide-y rounded-lg border">
              {days.map((d, i) => {
                const s = normalizeSchedules(
                  days.map((x) => ({
                    mode: x.mode,
                    start: x.start,
                    end: x.end,
                    required_minutes: Math.round(Number(x.required) * 60),
                  })),
                )[i];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="w-10 text-sm font-medium">{WEEKDAYS[i].label}</div>
                    <Select
                      value={d.mode}
                      onValueChange={(v) => setDay(i, { mode: v as ScheduleMode })}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flexible">Flexible</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                      </SelectContent>
                    </Select>
                    {d.mode !== "off" && (
                      <>
                        <Input
                          type="time"
                          className="h-8 w-28 text-xs"
                          value={d.start}
                          onChange={(e) => setDay(i, { start: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <Input
                          type="time"
                          className="h-8 w-28 text-xs"
                          value={d.end}
                          onChange={(e) => setDay(i, { end: e.target.value })}
                        />
                      </>
                    )}
                    {d.mode === "flexible" && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          step="0.5"
                          min={1}
                          className="h-8 w-20 text-xs"
                          value={d.required}
                          onChange={(e) => setDay(i, { required: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">hours</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1 text-right text-[11px] text-muted-foreground">
                      {describeSchedule(s, Number(f.grace_minutes) || 0)}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              <strong>Flexible</strong>: complete the hours anywhere inside the window — only time
              inside it counts, and a login after the last possible start is late.{" "}
              <strong>Fixed</strong>: be there from start to end; late after start + grace.
            </p>
          </>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <NumField
            label="Grace on fixed days (min)"
            value={f.grace_minutes}
            onChange={(v) => setF({ ...f, grace_minutes: v })}
          />
          <NumField
            label="Half day below (min)"
            value={f.half_day_minutes}
            hint={`${formatMinutes(Number(f.half_day_minutes) || 0)} — between this and the full requirement is "left early"`}
            onChange={(v) => setF({ ...f, half_day_minutes: v })}
          />
          <NumField
            label="Idle after (min without CRM activity)"
            value={f.idle_threshold_minutes}
            onChange={(v) => setF({ ...f, idle_threshold_minutes: v })}
          />
        </div>

        <div className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium text-foreground">Leave policy</div>
          <div className="grid gap-3 md:grid-cols-3">
            <NumField
              label="Leaves per month"
              value={f.monthly_leave_quota}
              onChange={(v) => setF({ ...f, monthly_leave_quota: v })}
            />
            <NumField
              label="Max carried to next month"
              value={f.leave_carry_cap}
              onChange={(v) => setF({ ...f, leave_carry_cap: v })}
            />
            <div>
              <Label className="text-xs">Policy starts</Label>
              <Input
                type="date"
                value={f.leave_policy_start}
                onChange={(e) => setF({ ...f, leave_policy_start: e.target.value })}
              />
            </div>
          </div>
        </div>

        {toggles.map((t) => (
          <div
            key={t.key}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="text-xs">
              <div className="font-medium text-foreground">{t.title}</div>
              <div className="text-muted-foreground">{t.hint}</div>
            </div>
            <Button
              size="sm"
              variant={f[t.key] ? "default" : "outline"}
              onClick={() => setF({ ...f, [t.key]: !f[t.key] })}
            >
              {f[t.key] ? "On" : "Off"}
            </Button>
          </div>
        ))}

        <div className="flex justify-end">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save schedule & policy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Consecutive days with the same rule grouped into one chip, Monday-first:
 * "Mon–Fri · Flexible 9h, 09:00–19:30", "Sat · Fixed 10:00–17:00", "Sun · Off".
 */
function scheduleSummary(days: ScheduleDraft[]): { days: string; rule: string }[] {
  const rule = (d: ScheduleDraft) =>
    d.mode === "off"
      ? "Off"
      : d.mode === "fixed"
        ? `Fixed ${d.start}–${d.end}`
        : `Flexible ${d.required}h, ${d.start}–${d.end}`;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; rule: string }[] = [];
  for (const i of order) {
    const r = rule(days[i]);
    const last = groups[groups.length - 1];
    if (last && last.rule === r) last.to = i;
    else groups.push({ from: i, to: i, rule: r });
  }
  return groups.map((g) => ({
    days:
      g.from === g.to
        ? WEEKDAYS[g.from].label
        : `${WEEKDAYS[g.from].label}–${WEEKDAYS[g.to].label}`,
    rule: g.rule,
  }));
}

function toDraft(s: DaySchedule[]): ScheduleDraft[] {
  return s.map((d) => ({
    mode: d.mode,
    start: d.start,
    end: d.end,
    required: String(
      Math.round(((d.mode === "flexible" ? d.required_minutes : 540) / 60) * 100) / 100,
    ),
  }));
}

function NumField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
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
