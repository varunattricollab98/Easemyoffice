// Shared building blocks for the B2B Analytics screens (Performance, Source,
// Employee, Revenue). Heavy on recharts, so it lives in src/components/b2b and
// is only imported by the analytics route bodies — recharts never reaches the
// entry chunk.
//
// The filter set (spec section 14) is modelled here as a controlled bar; each
// analytics screen owns the filter state and passes the already-filtered rows
// to the pure maths in src/lib/b2b-analytics.ts.

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PERIOD_OPTIONS, type PeriodId } from "@/lib/report-period";
import { FIRM_TYPES, PARTNER_HEALTH, B2B_LEAD_STATUSES } from "@/lib/b2b";
import type { AssignableUser } from "@/lib/b2b-queries";
import type { SourceOption } from "@/lib/b2b-analytics";

export type AnalyticsFilters = {
  period: PeriodId;
  from?: string;
  to?: string;
  /** YYYY-MM selected from the month dropdown, or "" for none. */
  month: string;
  employee: string;
  city: string;
  state: string;
  source: string;
  firmType: string;
  partnerStatus: string;
  leadStatus: string;
};

export const DEFAULT_FILTERS: AnalyticsFilters = {
  period: "this_month",
  month: "",
  employee: "",
  city: "",
  state: "",
  source: "",
  firmType: "",
  partnerStatus: "",
  leadStatus: "",
};

const ANY = "__any__";

/** The last 12 YYYY-MM month options for the Month dropdown. */
export function monthOptions(now = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleString(undefined, { month: "short", year: "numeric" }) });
  }
  return out;
}

export function FilterBar({
  filters,
  onChange,
  users,
  sources,
  cities,
  states,
}: {
  filters: AnalyticsFilters;
  onChange: (next: AnalyticsFilters) => void;
  users: AssignableUser[];
  sources: SourceOption[];
  cities: string[];
  states: string[];
}) {
  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...filters, ...patch });
  const months = useMemo(() => monthOptions(), []);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-3">
        {PERIOD_OPTIONS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={filters.period === p.id && !filters.month ? "default" : "outline"}
            onClick={() => set({ period: p.id, month: "" })}
          >
            {p.label}
          </Button>
        ))}
        {filters.period === "custom" && !filters.month && (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              className="h-9 w-auto"
              value={filters.from ?? ""}
              onChange={(e) => set({ from: e.target.value || undefined })}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              className="h-9 w-auto"
              value={filters.to ?? ""}
              onChange={(e) => set({ to: e.target.value || undefined })}
            />
          </div>
        )}

        <FilterSelect
          placeholder="Month"
          value={filters.month}
          onValueChange={(v) => set({ month: v })}
          options={months}
        />
        <FilterSelect
          placeholder="Employee"
          value={filters.employee}
          onValueChange={(v) => set({ employee: v })}
          options={users.map((u) => ({ value: u.id, label: u.full_name || u.email || "Unknown" }))}
        />
        <FilterSelect
          placeholder="City"
          value={filters.city}
          onValueChange={(v) => set({ city: v })}
          options={cities.map((c) => ({ value: c, label: c }))}
        />
        <FilterSelect
          placeholder="State"
          value={filters.state}
          onValueChange={(v) => set({ state: v })}
          options={states.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          placeholder="Source"
          value={filters.source}
          onValueChange={(v) => set({ source: v })}
          options={sources.map((s) => ({ value: s.id, label: s.label }))}
        />
        <FilterSelect
          placeholder="Firm Type"
          value={filters.firmType}
          onValueChange={(v) => set({ firmType: v })}
          options={FIRM_TYPES.map((f) => ({ value: f.id, label: f.label }))}
        />
        <FilterSelect
          placeholder="Partner Status"
          value={filters.partnerStatus}
          onValueChange={(v) => set({ partnerStatus: v })}
          options={PARTNER_HEALTH.map((p) => ({ value: p.id, label: p.label }))}
        />
        <FilterSelect
          placeholder="Lead Status"
          value={filters.leadStatus}
          onValueChange={(v) => set({ leadStatus: v })}
          options={B2B_LEAD_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
        />
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          Reset
        </Button>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  placeholder,
  value,
  onValueChange,
  options,
}: {
  placeholder: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onValueChange(v === ANY ? "" : v)}>
      <SelectTrigger className="h-9 w-auto min-w-[8rem]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A labelled bar chart over {label,value} points. */
export function SimpleBarChart({
  title,
  data,
  color = "var(--chart-1, oklch(0.62 0.19 260))",
  valueKey = "value",
  money = false,
}: {
  title: string;
  data: { label: string; value: number }[];
  color?: string;
  valueKey?: string;
  money?: boolean;
}) {
  const config = { [valueKey]: { label: title, color } } satisfies ChartConfig;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No data.</div>
        ) : (
          <ChartContainer config={config} className="h-[240px] w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={money ? 60 : 36}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey={valueKey} fill={`var(--color-${valueKey})`} radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** A labelled line chart over {label,value} points. */
export function SimpleLineChart({
  title,
  data,
  color = "var(--chart-2, oklch(0.7 0.17 160))",
  valueKey = "value",
}: {
  title: string;
  data: { label: string; value: number }[];
  color?: string;
  valueKey?: string;
}) {
  const config = { [valueKey]: { label: title, color } } satisfies ChartConfig;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No data.</div>
        ) : (
          <ChartContainer config={config} className="h-[240px] w-full">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={36}
                allowDecimals={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey={valueKey}
                stroke={`var(--color-${valueKey})`}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Apply the shared filter set to the fetched analytics rows. The period/month
 * windows are applied to created_at; the categorical filters are applied to the
 * relevant row columns. Returns a filtered copy of each list so the pure maths
 * can be run over exactly the rows the user asked for.
 */
export function monthToRange(month: string): { from: number; to: number } | null {
  if (!month) return null;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;
  const from = new Date(y, m - 1, 1).getTime();
  const to = new Date(y, m, 1).getTime();
  return { from, to };
}
