import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Users, BookOpen, UserCheck, Loader2, Phone, Mail } from "lucide-react";

// Global search palette: search leads, bookings and clients by name / phone /
// email / booking id from anywhere (Cmd/Ctrl+K or the sidebar Search button).
// Uses server-side ILIKE queries (not cmdk's client filter) so it searches the
// whole database, not just what's on screen.

const fmtINR = (n: number) => `\u20B9${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const normPhone = (v?: string | null) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};

interface LeadHit { id: string; lead_code: string | null; client_name: string; mobile: string | null; email: string | null; company_name: string | null; }
interface BookingHit { id: string; booking_code: string | null; external_booking_id: string | null; client_name: string | null; business_name: string | null; contact_no: string | null; email_id: string | null; plan_name: string | null; }

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce typing so we don't fire a query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Reset when closed.
  useEffect(() => {
    if (!open) { setTerm(""); setDebounced(""); }
  }, [open]);

  const enabled = open && debounced.length >= 2;
  const like = debounced.replace(/[%,]/g, " ").trim();

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", like, isAdmin, user?.id],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const esc = `%${like}%`;
      const digitsOnly = like.replace(/\D/g, "");
      const phoneEsc = digitsOnly.length >= 4 ? `%${digitsOnly}%` : null;

      // Leads (server-side across the whole table; RLS still applies).
      let leadsQ = supabase
        .from("leads")
        .select("id, lead_code, client_name, mobile, email, company_name")
        .or(
          [
            `client_name.ilike.${esc}`,
            `company_name.ilike.${esc}`,
            `email.ilike.${esc}`,
            `lead_code.ilike.${esc}`,
            `mobile.ilike.${esc}`,
          ].join(","),
        )
        .limit(8);
      if (!isAdmin && user?.id) leadsQ = leadsQ.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);

      // Bookings (also cover phone/email/business/booking codes).
      const bookingsQ = supabase
        .from("bookings")
        .select("id, booking_code, external_booking_id, client_name, business_name, contact_no, email_id, plan_name")
        .or(
          [
            `client_name.ilike.${esc}`,
            `business_name.ilike.${esc}`,
            `email_id.ilike.${esc}`,
            `contact_no.ilike.${esc}`,
            `booking_code.ilike.${esc}`,
            `external_booking_id.ilike.${esc}`,
            ...(phoneEsc ? [`alt_contact_no.ilike.${phoneEsc}`, `alt_contact_no_2.ilike.${phoneEsc}`] : []),
          ].join(","),
        )
        .limit(8);

      const [leadsRes, bookingsRes] = await Promise.all([leadsQ, bookingsQ]);
      return {
        leads: (leadsRes.data ?? []) as LeadHit[],
        bookings: (bookingsRes.data ?? []) as BookingHit[],
      };
    },
  });

  // Derive distinct "clients" from booking hits (grouped by phone → email → name),
  // mirroring the Clients page grouping so a search result opens the client list.
  const clients = useMemo(() => {
    const map = new Map<string, { key: string; name: string; company: string; phone: string }>();
    for (const b of data?.bookings ?? []) {
      const phone = normPhone(b.contact_no);
      const key = phone || (b.email_id ?? "").toLowerCase() || (b.client_name ?? "").toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, { key, name: b.client_name || b.business_name || "Client", company: b.business_name || "", phone: b.contact_no || "" });
    }
    return Array.from(map.values()).slice(0, 5);
  }, [data?.bookings]);

  const go = (fn: () => void) => { onOpenChange(false); fn(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-xl">
        <Command shouldFilter={false} className="[&_[cmdk-input]]:h-12">
          <CommandInput
            ref={inputRef}
            value={term}
            onValueChange={setTerm}
            placeholder="Search leads, bookings, clients by name, phone, email, ID…"
          />
          <CommandList>
            {!enabled && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            )}
            {enabled && isFetching && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {enabled && !isFetching &&
              (data?.leads.length ?? 0) === 0 &&
              (data?.bookings.length ?? 0) === 0 &&
              clients.length === 0 && <CommandEmpty>No matches found.</CommandEmpty>}

            {(data?.leads.length ?? 0) > 0 && (
              <CommandGroup heading="Leads">
                {data!.leads.map((l) => (
                  <CommandItem
                    key={l.id}
                    value={`lead-${l.id}`}
                    onSelect={() => go(() => navigate({ to: "/leads/$id", params: { id: l.id } }))}
                  >
                    <Users className="mr-2 h-4 w-4 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {l.client_name || "(no name)"}
                        {l.lead_code ? <span className="ml-2 text-xs font-normal text-muted-foreground">{l.lead_code}</span> : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[l.mobile, l.email, l.company_name].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(data?.bookings.length ?? 0) > 0 && (
              <CommandGroup heading="Bookings">
                {data!.bookings.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`booking-${b.id}`}
                    onSelect={() => go(() => navigate({ to: "/bookings", search: { q: (b.booking_code || b.client_name || "") as string } as never }))}
                  >
                    <BookOpen className="mr-2 h-4 w-4 shrink-0 text-violet-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {b.client_name || b.business_name || "(no name)"}
                        {(b.booking_code || b.external_booking_id) ? <span className="ml-2 text-xs font-normal text-muted-foreground">{b.booking_code || b.external_booking_id}</span> : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[b.plan_name, b.contact_no, b.email_id].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {clients.length > 0 && (
              <CommandGroup heading="Clients">
                {clients.map((c) => (
                  <CommandItem
                    key={c.key}
                    value={`client-${c.key}`}
                    onSelect={() => go(() => navigate({ to: "/clients", search: { q: (c.phone || c.name) as string } as never }))}
                  >
                    <UserCheck className="mr-2 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[c.company, c.phone].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
