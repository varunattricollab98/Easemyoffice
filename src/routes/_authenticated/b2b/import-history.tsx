import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, History as HistoryIcon, Upload, X } from "lucide-react";
import { format } from "date-fns";
import { guardRoles } from "@/lib/route-guard";
import { B2B_SOURCES, B2B_LEAD_STATUSES, labelFor, type B2BImportBatch } from "@/lib/b2b";
import { listImportBatches, listB2BLeads, listAssignableUsers } from "@/lib/b2b-queries";

export const Route = createFileRoute("/_authenticated/b2b/import-history")({
  head: () => ({ meta: [{ title: "Import History — EaseMyOffice CRM" }] }),
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "b2b"]);
  },
  component: ImportHistoryPage,
});

function ImportHistoryPage() {
  const navigate = useNavigate();
  const [openBatch, setOpenBatch] = useState<B2BImportBatch | null>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["b2b-import-batches"],
    queryFn: listImportBatches,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["b2b-assignable-users"],
    queryFn: listAssignableUsers,
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.full_name || u.email || ""));
    return m;
  }, [users]);

  return (
    <div className="p-5 md:p-10 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
            <HistoryIcon className="h-5 w-5" />
          </div>
          <div>
            <Link
              to="/b2b/leads"
              className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to B2B Leads
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">Import History</h1>
            <p className="text-sm text-muted-foreground">Every CSV import batch and its records.</p>
          </div>
        </div>
        <Button onClick={() => navigate({ to: "/b2b/import" })}>
          <Upload className="h-4 w-4 mr-2" /> New Import
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Import ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Duplicate</TableHead>
                <TableHead className="text-right">Invalid</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    No imports yet.{" "}
                    <Link to="/b2b/import" className="text-primary hover:underline">
                      Import a CSV
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b) => (
                <TableRow key={b.id} className="cursor-pointer" onClick={() => setOpenBatch(b)}>
                  <TableCell className="font-mono text-xs">{b.id.slice(0, 8)}</TableCell>
                  <TableCell>{format(new Date(b.created_at), "dd MMM yyyy, HH:mm")}</TableCell>
                  <TableCell>{b.uploaded_by ? nameById.get(b.uploaded_by) || "—" : "—"}</TableCell>
                  <TableCell>{labelFor(B2B_SOURCES, b.source)}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{b.file_name || "—"}</TableCell>
                  <TableCell className="text-right">{b.total_records}</TableCell>
                  <TableCell className="text-right text-success">{b.new_records}</TableCell>
                  <TableCell className="text-right text-warning">{b.duplicate_records}</TableCell>
                  <TableCell className="text-right text-destructive">{b.invalid_records}</TableCell>
                  <TableCell className="text-right text-primary">{b.assigned_records}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openBatch && (
        <BatchRecords batch={openBatch} nameById={nameById} onClose={() => setOpenBatch(null)} />
      )}
    </div>
  );
}

function BatchRecords({
  batch,
  nameById,
  onClose,
}: {
  batch: B2BImportBatch;
  nameById: Map<string, string>;
  onClose: () => void;
}) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["b2b-batch-leads", batch.id],
    queryFn: () => listB2BLeads({ importBatchId: batch.id }),
  });

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">
              Records in batch <span className="font-mono text-xs">{batch.id.slice(0, 8)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {batch.file_name || "—"} · {labelFor(B2B_SOURCES, batch.source)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No records in this batch.
                  </TableCell>
                </TableRow>
              )}
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.contact_person || "—"}</TableCell>
                  <TableCell>{l.phone || "—"}</TableCell>
                  <TableCell>{l.email || "—"}</TableCell>
                  <TableCell>{l.city || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{labelFor(B2B_LEAD_STATUSES, l.lead_status)}</Badge>
                  </TableCell>
                  <TableCell>
                    {l.assigned_to ? nameById.get(l.assigned_to) || "—" : "Unassigned"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
