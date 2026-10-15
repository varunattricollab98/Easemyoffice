import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DOC_STAGES, WAITING_ON_LABEL } from "@/lib/documentation";
import { useSaveDocSettings, type DocSettings } from "@/lib/documentation-queries";
import { StageDot } from "./doc-ui";

export function DocSettingsPanel({ settings }: { settings: DocSettings }) {
  const save = useSaveDocSettings();
  const [tat, setTat] = useState(String(settings.tatDays));
  const [alert, setAlert] = useState(String(settings.stageAlertDays));
  useEffect(() => {
    setTat(String(settings.tatDays));
    setAlert(String(settings.stageAlertDays));
  }, [settings.tatDays, settings.stageAlertDays]);

  const tatN = Number(tat);
  const alertN = Number(alert);
  const valid =
    Number.isInteger(tatN) &&
    tatN >= 1 &&
    tatN <= 60 &&
    Number.isInteger(alertN) &&
    alertN >= 1 &&
    alertN <= 60;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="surface-card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">TAT & alerts</h2>
          <p className="text-sm text-muted-foreground">
            Applies to newly assigned files. Existing files keep the deadline they were given.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-tat">TAT (calendar days)</Label>
            <Input
              id="doc-tat"
              type="number"
              min={1}
              max={60}
              value={tat}
              onChange={(e) => setTat(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Assignment → Completed.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-alert">Stuck-in-stage alert (days)</Label>
            <Input
              id="doc-alert"
              type="number"
              min={1}
              max={60}
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Flag files that haven't moved for this long.
            </p>
          </div>
        </div>
        <Button
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({ tatDays: tatN, stageAlertDays: alertN })}
        >
          {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-3 font-semibold">Pipeline stages</h2>
        <ol className="space-y-2">
          {DOC_STAGES.map((s, i) => (
            <li key={s.id} className="flex items-start gap-2.5 text-sm">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <StageDot stage={s.id} className="mt-1.5" />
              <div className="min-w-0">
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">
                  {s.next}
                  {s.waitingOn !== "done" &&
                    ` · waiting on ${WAITING_ON_LABEL[s.waitingOn].toLowerCase()}`}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
