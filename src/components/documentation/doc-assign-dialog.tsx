import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emailDocAssignee, useDocTeam } from "@/lib/documentation-queries";
import { cn } from "@/lib/utils";

interface BookingPick {
  id: string;
  booking_code: string | null;
  external_booking_id: string | null;
  booking_date: string | null;
  client_name: string | null;
  business_name: string | null;
  sp_name: string | null;
}

/**
 * Assign a booking that has no documentation file yet (e.g. "Skip" was pressed
 * after saving it). Bookings already in the pipeline are hidden because the
 * table allows one documentation file per booking.
 */
export function DocAssignDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const { data: team = [] } = useDocTeam(open);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["doc-pipeline", "unassigned-bookings"],
    enabled: open,
    queryFn: async (): Promise<BookingPick[]> => {
      const [{ data: rows, error }, { data: taken }] = await Promise.all([
        supabase
          .from("bookings")
          .select(
            "id, booking_code, external_booking_id, booking_date, client_name, business_name, sp_name",
          )
          .order("booking_date", { ascending: false })
          .limit(300),
        supabase.from("documentation_tasks").select("booking_id").limit(5000),
      ]);
      if (error) throw new Error(error.message);
      const used = new Set((taken ?? []).map((t) => t.booking_id));
      return ((rows ?? []) as BookingPick[]).filter((b) => !used.has(b.id));
    },
  });

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return bookings
      .filter(
        (b) =>
          !n ||
          [b.client_name, b.business_name, b.external_booking_id, b.booking_code, b.sp_name].some(
            (v) => (v ?? "").toLowerCase().includes(n),
          ),
      )
      .slice(0, 50);
  }, [bookings, q]);

  const assign = useMutation({
    mutationFn: async () => {
      if (!bookingId || !assignee) throw new Error("Pick a booking and a person");
      const { error } = await supabase.from("documentation_tasks").insert({
        booking_id: bookingId,
        assigned_to: assignee,
        assigned_by: user?.id ?? null,
        stage: "assigned",
      });
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "This booking is already in the documentation pipeline"
            : error.message,
        );
      }
      return { bookingId, assignee };
    },
    onSuccess: ({ bookingId: b, assignee: a }) => {
      toast.success("Assigned to documentation");
      qc.invalidateQueries({ queryKey: ["doc-pipeline"] });
      void emailDocAssignee(b, a).then((sent) => {
        if (!sent)
          toast.warning("Assigned, but the email to the documentation person could not be sent");
      });
      setOpen(false);
      setBookingId(null);
      setAssignee("");
      setQ("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-4 w-4" /> Assign booking
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign a booking to documentation</DialogTitle>
            <DialogDescription>
              Bookings that are not in the documentation pipeline yet.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search client, business, booking ID, SP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="scrollbar-modern max-h-64 overflow-y-auto rounded-lg border">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
              </div>
            ) : list.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No unassigned bookings found.
              </div>
            ) : (
              list.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBookingId(b.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50",
                    bookingId === b.id && "bg-primary/10",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.business_name || b.client_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {b.external_booking_id || b.booking_code} · {b.booking_date}
                      {b.sp_name ? ` · ${b.sp_name}` : ""}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Documentation person</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                {team.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name || m.email || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!bookingId || !assignee || assign.isPending}
              onClick={() => assign.mutate()}
            >
              {assign.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
