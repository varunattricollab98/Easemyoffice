import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Bell, IndianRupee } from "lucide-react";
import { useState, useMemo } from "react";
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth, isSameDay,
  addMonths, subMonths, startOfWeek, endOfWeek,
} from "date-fns";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — EaseMyOffice CRM" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<Date | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const { data: followups = [] } = useQuery({
    queryKey: ["calendar-followups", monthStart.toISOString(), monthEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from("follow_ups").select("id, action, due_at, status, lead_id")
        .gte("due_at", calStart.toISOString()).lte("due_at", calEnd.toISOString()).limit(500);
      return data ?? [];
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["calendar-bookings", monthStart.toISOString(), monthEnd.toISOString()],
    queryFn: async () => {
      const { data } = await supabase.from("bookings").select("id, client_name, balance_due_date, balance_amount, booking_code")
        .not("balance_due_date", "is", null)
        .gte("balance_due_date", format(calStart, "yyyy-MM-dd"))
        .lte("balance_due_date", format(calEnd, "yyyy-MM-dd"));
      return data ?? [];
    },
  });

  const eventsByDay = useMemo(() => {
    const m = new Map<string, { followups: any[]; payments: any[] }>();
    days.forEach((d) => m.set(format(d, "yyyy-MM-dd"), { followups: [], payments: [] }));
    followups.forEach((f: any) => {
      const k = format(new Date(f.due_at), "yyyy-MM-dd");
      m.get(k)?.followups.push(f);
    });
    bookings.forEach((b: any) => {
      m.get(b.balance_due_date)?.payments.push(b);
    });
    return m;
  }, [days, followups, bookings]);

  const selectedKey = selected ? format(selected, "yyyy-MM-dd") : null;
  const selectedEvents = selectedKey ? eventsByDay.get(selectedKey) : null;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl md:text-3xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setCursor(subMonths(cursor, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-medium min-w-32 text-center">{format(cursor, "MMMM yyyy")}</div>
          <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>Today</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-7 text-xs text-muted-foreground font-medium border-b">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="p-2 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const inMonth = isSameMonth(d, cursor);
              const isToday = isSameDay(d, new Date());
              const isSelected = selected && isSameDay(d, selected);
              const k = format(d, "yyyy-MM-dd");
              const ev = eventsByDay.get(k)!;
              const total = ev.followups.length + ev.payments.length;
              return (
                <button
                  key={k}
                  onClick={() => setSelected(d)}
                  className={`min-h-20 p-1.5 border-b border-r text-left transition-colors ${
                    !inMonth ? "bg-muted/20 text-muted-foreground" : "hover:bg-muted/40"
                  } ${isSelected ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""}`}
                >
                  <div className={`text-xs font-medium ${isToday ? "text-primary" : ""}`}>
                    {format(d, "d")}
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {ev.followups.length > 0 && (
                      <div className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded px-1 truncate">
                        {ev.followups.length} follow-up{ev.followups.length > 1 ? "s" : ""}
                      </div>
                    )}
                    {ev.payments.length > 0 && (
                      <div className="text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 rounded px-1 truncate">
                        {ev.payments.length} payment{ev.payments.length > 1 ? "s" : ""}
                      </div>
                    )}
                    {total === 0 && inMonth && <div className="text-[10px] text-muted-foreground/50">—</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selected && selectedEvents && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-medium">{format(selected, "EEEE, MMMM d, yyyy")}</div>
            {selectedEvents.followups.length === 0 && selectedEvents.payments.length === 0 && (
              <p className="text-sm text-muted-foreground">No events scheduled.</p>
            )}
            {selectedEvents.followups.map((f: any) => (
              <Link key={f.id} to="/leads/$id" params={{ id: f.lead_id }} className="flex items-center gap-2 p-2 rounded hover:bg-muted/40">
                <Bell className="h-4 w-4 text-blue-600" />
                <span className="text-sm flex-1">{f.action}</span>
                <Badge variant="outline" className="text-xs">{format(new Date(f.due_at), "h:mm a")}</Badge>
              </Link>
            ))}
            {selectedEvents.payments.map((b: any) => (
              <div key={b.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/40">
                <IndianRupee className="h-4 w-4 text-amber-600" />
                <span className="text-sm flex-1">{b.client_name} · {b.booking_code}</span>
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  ₹{Number(b.balance_amount || 0).toLocaleString("en-IN")} due
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
