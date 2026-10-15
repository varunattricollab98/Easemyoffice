import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DocWorkspace,
  type DocSearch,
  type DocTab,
} from "@/components/documentation/doc-workspace";
import { DOC_STAGES, type DocStage } from "@/lib/documentation";
import { guardRoles } from "@/lib/route-guard";

const TABS: DocTab[] = ["overview", "board", "list", "analytics", "settings"];
const STAGE_IDS = DOC_STAGES.map((s) => s.id as string);

export const Route = createFileRoute("/_authenticated/documentation")({
  head: () => ({ meta: [{ title: "Documentation — EaseMyOffice CRM" }] }),
  validateSearch: (s: Record<string, unknown>): DocSearch => ({
    tab:
      typeof s.tab === "string" && TABS.includes(s.tab as DocTab) ? (s.tab as DocTab) : undefined,
    stage:
      typeof s.stage === "string" && STAGE_IDS.includes(s.stage)
        ? (s.stage as DocStage)
        : undefined,
    task: typeof s.task === "string" ? s.task : undefined,
  }),
  // UX guard only; RLS on documentation_tasks is the real boundary (admin sees
  // all files, everyone else only the files assigned to them).
  beforeLoad: async ({ context }) => {
    await guardRoles(context.queryClient, ["admin", "documentation", "sales"]);
  },
  component: DocumentationPage,
});

function DocumentationPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DocWorkspace search={search} onSearch={(next) => navigate({ search: next, replace: true })} />
  );
}
