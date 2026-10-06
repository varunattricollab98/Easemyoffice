import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserCheck, Search } from "lucide-react";
import { guardRoles } from "@/lib/route-guard";
import { listAllContacts } from "@/lib/b2b-queries";

export const Route = createFileRoute("/_authenticated/b2b/contacts/")({
  head: () => ({ meta: [{ title: "B2B Contacts — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ContactsListPage,
});

function ContactsListPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["b2b-contacts", q.trim()],
    queryFn: () => listAllContacts(q.trim() || undefined),
  });

  const goToFirm = (firmId: string) => navigate({ to: "/b2b/firms/$id", params: { id: firmId } });

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <UserCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People across every CA firm.
            {contacts.length > 0 && (
              <>
                {" "}
                · <span className="font-medium text-foreground">{contacts.length}</span> shown
              </>
            )}
          </p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search contact name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="shadow-sm hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Firm</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    No contacts yet.
                  </TableCell>
                </TableRow>
              )}
              {contacts.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => goToFirm(c.firm_id)}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {c.name}
                      {c.is_primary && (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                          Primary
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{c.designation || "—"}</TableCell>
                  <TableCell>{c.firm_name || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell className="truncate max-w-[220px]">{c.email || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {!isLoading && contacts.length === 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-6 text-center text-muted-foreground">
              No contacts yet.
            </CardContent>
          </Card>
        )}
        {contacts.map((c) => (
          <Card
            key={c.id}
            className="shadow-sm active:scale-[0.99] transition-transform"
            onClick={() => goToFirm(c.firm_id)}
          >
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{c.name}</div>
                {c.is_primary && (
                  <Badge className="bg-amber-500 text-white hover:bg-amber-500">Primary</Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{c.firm_name || "—"}</div>
              <div className="text-xs text-muted-foreground">
                {[c.designation, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
