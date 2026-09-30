// One-click import: creates an employee record for every CRM login that does
// not have one yet, already linked (employees.profile_id), so attendance works
// for them straight away. Code, name, email, phone and department are filled
// from the CRM profile; the admin completes joining date etc. afterwards.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/utils";
import {
  hrmsDb,
  nextEmployeeCodes,
  splitName,
  type Department,
  type Employee,
  type OfficeLocation,
} from "@/lib/hrms";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
};

export function ImportTeamButton({
  employees,
  departments,
  offices,
}: {
  employees: Employee[];
  departments: Department[];
  offices: OfficeLocation[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const { data: profiles = [] } = useQuery({
    queryKey: ["hrms-import-profiles"],
    queryFn: async (): Promise<Profile[]> => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, department")
        .order("full_name");
      return (data ?? []) as Profile[];
    },
  });

  const unlinked = useMemo(() => {
    const linked = new Set(employees.map((e) => e.profile_id).filter(Boolean));
    return profiles.filter((p) => !linked.has(p.id));
  }, [profiles, employees]);

  // Everyone ticked by default each time the dialog opens.
  useEffect(() => {
    if (open) setPicked(new Set(unlinked.map((p) => p.id)));
  }, [open, unlinked]);

  const deptId = (name: string | null) => {
    const n = (name ?? "").trim().toLowerCase();
    if (!n) return null;
    return (
      departments.find((d) => d.name.toLowerCase() === n)?.id ??
      departments.find((d) => d.name.toLowerCase().startsWith(n))?.id ??
      null
    );
  };

  const run = useMutation({
    mutationFn: async () => {
      const chosen = unlinked.filter((p) => picked.has(p.id));
      if (chosen.length === 0) throw new Error("Pick at least one person");
      const codes = nextEmployeeCodes(
        employees.map((e) => e.employee_code),
        chosen.length,
      );
      const rows = chosen.map((p, i) => {
        const { first, last } = splitName(p.full_name, p.email);
        return {
          profile_id: p.id,
          employee_code: codes[i],
          first_name: first,
          last_name: last,
          email: p.email,
          phone: p.phone,
          department_id: deptId(p.department),
          office_id: offices[0]?.id ?? null,
          employment_type: "full_time",
          employment_status: "active",
        };
      });
      const { error } = await hrmsDb().from("employees").insert(rows);
      if (error) throw new Error(error.message);
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} employee(s) added and linked — attendance is ready for them`);
      qc.invalidateQueries({ queryKey: ["hrms-employees"] });
      qc.invalidateQueries({ queryKey: ["hrms-employees-lite"] });
      setOpen(false);
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e)),
  });

  if (unlinked.length === 0) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 h-4 w-4" /> Import team from CRM ({unlinked.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import team from CRM</DialogTitle>
            <DialogDescription>
              Creates an employee record for each selected login, already linked, so they can mark
              attendance right away. Add joining date and designation afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
            {unlinked.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <Checkbox
                  checked={picked.has(p.id)}
                  onCheckedChange={(v) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (v === true) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.full_name || p.email}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.email, p.department].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={run.isPending || picked.size === 0} onClick={() => run.mutate()}>
              {run.isPending ? "Adding…" : `Add ${picked.size} employee(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
