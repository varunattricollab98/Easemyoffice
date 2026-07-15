import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";

const pad = (n: number) => String(n).padStart(2, "0");

// Local "YYYY-MM-DDTHH:mm" string (same shape as <input type="datetime-local">).
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = value ? new Date(value) : new Date();

  const h24 = current.getHours();
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm: "AM" | "PM" = h24 < 12 ? "AM" : "PM";
  const minute = current.getMinutes();

  const commit = (next: Date) => onChange(toLocalInput(next));

  const setDatePart = (d?: Date) => {
    if (!d) return;
    const next = new Date(current);
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    commit(next);
  };
  const setHour = (h12: number) => {
    const next = new Date(current);
    next.setHours(ampm === "PM" ? (h12 % 12) + 12 : h12 % 12);
    commit(next);
  };
  const setMinute = (m: number) => { const next = new Date(current); next.setMinutes(m); commit(next); };
  const setAmpm = (ap: "AM" | "PM") => {
    const next = new Date(current);
    let h = next.getHours();
    if (ap === "AM" && h >= 12) h -= 12;
    if (ap === "PM" && h < 12) h += 12;
    next.setHours(h);
    commit(next);
  };

  const label = value
    ? new Date(value).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Pick date & time";

  const selectCls = "h-9 rounded-md border bg-background px-2 text-sm w-full";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal">
          <CalendarClock className="h-4 w-4 mr-2 text-muted-foreground" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <Calendar mode="single" selected={current} onSelect={setDatePart} defaultMonth={current} />
          <div className="border-t sm:border-t-0 sm:border-l p-3 flex flex-col gap-2 sm:w-56">
            <div className="text-xs font-medium text-muted-foreground">Time</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Hour</div>
                <select className={selectCls} value={hour12} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Min</div>
                <select className={selectCls} value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">AM/PM</div>
                <select className={selectCls} value={ampm} onChange={(e) => setAmpm(e.target.value as "AM" | "PM")}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => commit(new Date(Date.now() + 60 * 60000))}>+1 hour</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => commit(new Date(Date.now() + 24 * 60 * 60000))}>+1 day</Button>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t p-2">
          <Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
