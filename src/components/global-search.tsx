import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatINR as fmtINR } from "@/lib/utils";
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
import { Users, BookOpen, UserCheck, Loader2, Building2, Share2 } from "lucide-react";
import { b2bDb } from "@/lib/b2b";

// Global search palette: search leads, bookings, clients AND the B2B entities
// (CA firms, B2B leads, contacts, referrals) by name / phone / email / id from
// anywhere (Cmd/Ctrl+K or the sidebar Search button). Uses server-side ILIKE
// queries (not cmdk's client filter) so it searches the whole database, not
// just what's on screen. Every query runs through RLS, so a user only ever gets
// back rows they are allowed to see (an admin gets everything).

const normPhone = (v?: string | null) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};

interface LeadHit { id: string; lead_code: string | null; client_name: string; mobile: string | null; email: string | null; company_name: string | null; }
interface BookingHit { id: string; booking_code: string | null; external_booking_id: string | null; client_name: string | null; business_name: string | null; contact_no: string | null; email_id: string | null; plan_name: string | null; }
interface FirmHit {
  id: string;
  firm_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  partner_status: string | null;
}
interface B2BLeadHit {
  id: string;
  firm_id: string | null;
  b2b_lead_code: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  lead_status: string | null;
}
interface ContactHit {
  id: string;
  firm_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  designation: string | null;
}
interface ReferralHit {
  id: string;
  firm_id: string | null;
  referral_code: string | null;
  referred_client_name: string | null;
  client_phone: string | null;
  referral_status: string | null;
}

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

      // --- B2B entities. RLS scopes every row: a b2b user only matches their
      // own firms/leads/contacts/referrals, an admin matches all. No manual
      // assigned_to filter needed (and the generated types do not know these
      // tables, hence b2bDb()). Each is wrapped so a not-yet-deployed table does
      // not break the whole palette.
      const db = b2bDb();
      const firmsQ = db
        .from("ca_firms")
        .select("id, firm_name, phone, email, city, state, partner_status")
        .or(
          [
            `firm_name.ilike.${esc}`,
            `email.ilike.${esc}`,
            `phone.ilike.${esc}`,
            ...(phoneEsc ? [`alt_phone.ilike.${phoneEsc}`] : []),
          ].join(","),
        )
        .limit(6);
      const b2bLeadsQ = db
        .from("b2b_leads")
        .select("id, firm_id, b2b_lead_code, contact_person, phone, email, city, lead_status")
        .or(
          [
            `contact_person.ilike.${esc}`,
            `email.ilike.${esc}`,
            `phone.ilike.${esc}`,
            `b2b_lead_code.ilike.${esc}`,
            ...(phoneEsc ? [`alt_phone.ilike.${phoneEsc}`] : []),
          ].join(","),
        )
        .limit(6);
      const contactsQ = db
        .from("b2b_contacts")
        .select("id, firm_id, name, phone, email, designation")
        .or(
          [
            `name.ilike.${esc}`,
            `email.ilike.${esc}`,
            `phone.ilike.${esc}`,
            ...(phoneEsc ? [`alt_phone.ilike.${phoneEsc}`] : []),
          ].join(","),
        )
        .limit(6);
      const referralsQ = db
        .from("referrals")
        .select("id, firm_id, referral_code, referred_client_name, client_phone, referral_status")
        .or(
          [
            `referred_client_name.ilike.${esc}`,
            `client_phone.ilike.${esc}`,
            `referral_code.ilike.${esc}`,
          ].join(","),
        )
        .limit(6);

      const [leadsRes, bookingsRes, firmsRes, b2bLeadsRes, contactsRes, referralsRes] =
        await Promise.all([
          leadsQ,
          bookingsQ,
          firmsQ.then(
            (r: { data: unknown }) => r,
            () => ({ data: [] }),
          ),
          b2bLeadsQ.then(
            (r: { data: unknown }) => r,
            () => ({ data: [] }),
          ),
          contactsQ.then(
            (r: { data: unknown }) => r,
            () => ({ data: [] }),
          ),
          referralsQ.then(
            (r: { data: unknown }) => r,
            () => ({ data: [] }),
          ),
        ]);
      return {
        leads: (leadsRes.data ?? []) as LeadHit[],
        bookings: (bookingsRes.data ?? []) as BookingHit[],
        firms: (firmsRes.data ?? []) as FirmHit[],
        b2bLeads: (b2bLeadsRes.data ?? []) as B2BLeadHit[],
        contacts: (contactsRes.data ?? []) as ContactHit[],
        referrals: (referralsRes.data ?? []) as ReferralHit[],
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
      {/* Command-palette style: anchor near the top of the screen (not dead
          center), fixed width, and hide the default Dialog close button so the
          input's own clear ✕ is the only one. `top-[8%] translate-y-0` fully
          override the base Dialog's `top-[50%] translate-y-[-50%]` centering,
          and `max-h-[85vh]` caps the box height so the whole palette (input +
          results) always stays on screen and is never clipped at the top. */}
      <DialogContent className="overflow-hidden p-0 max-w-xl w-[92vw] top-[8%] translate-y-0 max-h-[85vh] rounded-xl shadow-2xl [&>button.absolute]:hidden">
        <Command shouldFilter={false} className="[&_[cmdk-input]]:h-12">
          <CommandInput
            ref={inputRef}
            value={term}
            onValueChange={setTerm}
            placeholder="Search leads, bookings, clients by name, phone, email, ID…"
          />
          <CommandList className="max-h-[60vh]">
            {!enabled && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
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
              (data?.firms.length ?? 0) === 0 &&
              (data?.b2bLeads.length ?? 0) === 0 &&
              (data?.contacts.length ?? 0) === 0 &&
              (data?.referrals.length ?? 0) === 0 &&
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

            {(data?.firms.length ?? 0) > 0 && (
              <CommandGroup heading="CA Firms">
                {data!.firms.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`firm-${f.id}`}
                    onSelect={() =>
                      go(() => navigate({ to: "/b2b/firms/$id", params: { id: f.id } }))
                    }
                  >
                    <Building2 className="mr-2 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {f.firm_name || "(no name)"}
                        {f.partner_status ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {f.partner_status}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[f.phone, f.email, [f.city, f.state].filter(Boolean).join(", ")]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(data?.b2bLeads.length ?? 0) > 0 && (
              <CommandGroup heading="B2B Leads">
                {data!.b2bLeads.map((l) => (
                  <CommandItem
                    key={l.id}
                    value={`b2blead-${l.id}`}
                    onSelect={() =>
                      go(() =>
                        l.firm_id
                          ? navigate({ to: "/b2b/firms/$id", params: { id: l.firm_id } })
                          : navigate({ to: "/b2b/leads" }),
                      )
                    }
                  >
                    <UserCheck className="mr-2 h-4 w-4 shrink-0 text-sky-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {l.contact_person || "(no name)"}
                        {l.b2b_lead_code ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {l.b2b_lead_code}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[l.phone, l.email, l.city, l.lead_status].filter(Boolean).join(" · ") ||
                          "—"}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(data?.contacts.length ?? 0) > 0 && (
              <CommandGroup heading="Contacts">
                {data!.contacts.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`b2bcontact-${c.id}`}
                    onSelect={() =>
                      go(() =>
                        c.firm_id
                          ? navigate({ to: "/b2b/firms/$id", params: { id: c.firm_id } })
                          : navigate({ to: "/b2b/contacts" }),
                      )
                    }
                  >
                    <Users className="mr-2 h-4 w-4 shrink-0 text-indigo-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {c.name || "(no name)"}
                        {c.designation ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {c.designation}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(data?.referrals.length ?? 0) > 0 && (
              <CommandGroup heading="Referrals">
                {data!.referrals.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`referral-${r.id}`}
                    onSelect={() => go(() => navigate({ to: "/b2b/referrals" }))}
                  >
                    <Share2 className="mr-2 h-4 w-4 shrink-0 text-rose-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {r.referred_client_name || "(referral)"}
                        {r.referral_code ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {r.referral_code}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[r.client_phone, r.referral_status].filter(Boolean).join(" · ") || "—"}
                      </div>
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
