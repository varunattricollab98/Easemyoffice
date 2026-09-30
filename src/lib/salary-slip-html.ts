// Printable salary slip as a standalone HTML document. Opened in a new window
// and printed, so "Save as PDF" in the print dialog gives the PDF.

import { amountInWords, type SalarySlip } from "@/lib/payroll";

export type SlipSnapshot = {
  slip: SalarySlip;
  month: string; // YYYY-MM
  company: { name: string; office: string | null };
  employee: {
    name: string;
    code: string;
    designation: string | null;
    department: string | null;
    joining_date: string | null;
    pan: string | null;
    uan: string | null;
    esi_number: string | null;
    bank_name: string | null;
    bank_account_no: string | null;
    bank_ifsc: string | null;
  };
  attendance: {
    present: number;
    short: number;
    halfDays: number;
    absent: number;
    paidLeave: number;
    unpaidLeave: number;
    remoteDays: number;
    workedMinutes: number;
    requiredMinutes: number;
  };
  note: string | null;
  generated_at: string;
};

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const hours = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;

/** "XXXXXX1234" — the slip never needs the full account number. */
export const maskAccount = (acc: string | null) =>
  acc ? `${"X".repeat(Math.max(0, acc.length - 4))}${acc.slice(-4)}` : null;

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function salarySlipHtml(s: SlipSnapshot): string {
  const e = s.employee;
  const rows = (pairs: [string, string | null][]) =>
    pairs
      .filter(([, v]) => v)
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
      .join("");
  const earnings = s.slip.earnings.filter((l) => l.amount > 0 || l.full > 0);
  const deductions = s.slip.deductions.filter((l) => l.amount > 0);
  const max = Math.max(earnings.length, deductions.length, 1);
  const lines = Array.from({ length: max })
    .map((_, i) => {
      const a = earnings[i];
      const d = deductions[i];
      return `<tr>
        <td>${a ? esc(a.label) : ""}</td><td class="n">${a && a.full ? inr(a.full) : a ? "—" : ""}</td><td class="n">${a ? inr(a.amount) : ""}</td>
        <td>${d ? esc(d.label) : ""}</td><td class="n">${d ? inr(d.amount) : ""}</td>
      </tr>`;
    })
    .join("");
  const at = s.attendance;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Salary Slip — ${esc(e.name)} — ${esc(
    monthLabel(s.month),
  )}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:0;padding:28px;background:#fff}
  .slip{max-width:820px;margin:0 auto;border:1px solid #d1d5db;border-radius:12px;overflow:hidden}
  .head{padding:18px 22px;background:linear-gradient(180deg,#f0fdf4,#fff);border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end}
  .co{font-size:20px;font-weight:700} .sub{font-size:12px;color:#6b7280;margin-top:2px}
  .title{font-size:14px;font-weight:600;text-align:right}
  .sec{padding:14px 22px;border-bottom:1px solid #f3f4f6}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  .info td{padding:3px 0} .info td.k{color:#6b7280;width:45%}
  .lines th{background:#f9fafb;text-align:left;font-weight:600;padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:12px}
  .lines td{padding:6px 8px;border-bottom:1px solid #f3f4f6} .n{text-align:right;font-variant-numeric:tabular-nums}
  .lines tr.tot td{font-weight:700;background:#f9fafb;border-top:1px solid #e5e7eb}
  .net{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;background:#f0fdf4}
  .net .v{font-size:22px;font-weight:700;color:#15803d}
  .words{font-size:12px;color:#374151;padding:0 22px 14px;background:#f0fdf4}
  .att{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
  .att div{border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font-size:11px;color:#6b7280}
  .att b{display:block;font-size:14px;color:#111827}
  .foot{padding:12px 22px;font-size:11px;color:#9ca3af;text-align:center}
  @media print{body{padding:0}.slip{border:none;border-radius:0}.noprint{display:none}}
</style></head><body>
<div class="slip">
  <div class="head">
    <div><div class="co">${esc(s.company.name)}</div>${s.company.office ? `<div class="sub">${esc(s.company.office)}</div>` : ""}</div>
    <div class="title">Salary Slip<div class="sub">${esc(monthLabel(s.month))}</div></div>
  </div>
  <div class="sec grid">
    <table class="info">${rows([
      ["Employee", e.name],
      ["Employee code", e.code],
      ["Designation", e.designation],
      ["Department", e.department],
      ["Date of joining", e.joining_date],
    ])}</table>
    <table class="info">${rows([
      ["PAN", e.pan],
      ["UAN", e.uan],
      ["ESI number", e.esi_number],
      ["Bank", [e.bank_name, maskAccount(e.bank_account_no)].filter(Boolean).join(" · ") || null],
      ["IFSC", e.bank_ifsc],
    ])}</table>
  </div>
  <div class="sec">
    <div class="att">
      <div>Days in month<b>${s.slip.daysInMonth}</b></div>
      <div>Paid days<b>${fmtDays(s.slip.paidDays)}</b></div>
      <div>LOP days<b>${fmtDays(s.slip.lopDays)}</b></div>
      <div>Present<b>${at.present}</b></div>
      <div>Hours completed<b>${hours(at.workedMinutes)}</b></div>
      <div>Paid leave<b>${fmtDays(at.paidLeave)}</b></div>
      <div>Unpaid leave<b>${fmtDays(at.unpaidLeave)}</b></div>
      <div>Absent<b>${at.absent}</b></div>
      <div>Half days<b>${at.halfDays}</b></div>
      <div>Left early<b>${at.short}</b></div>
    </div>
  </div>
  <div class="sec">
    <table class="lines">
      <thead><tr><th>Earnings</th><th class="n">Full month</th><th class="n">Earned</th><th>Deductions</th><th class="n">Amount</th></tr></thead>
      <tbody>${lines}
        <tr class="tot"><td>Gross earnings</td><td class="n">${inr(s.slip.fixedGross)}</td><td class="n">${inr(
          s.slip.grossEarnings,
        )}</td><td>Total deductions</td><td class="n">${inr(s.slip.totalDeductions)}</td></tr>
      </tbody>
    </table>
  </div>
  <div class="net"><div style="font-weight:600">Net pay</div><div class="v">${inr(s.slip.netPay)}</div></div>
  <div class="words">${esc(amountInWords(s.slip.netPay))}</div>
  ${s.note ? `<div class="sec" style="font-size:12px"><b>Note:</b> ${esc(s.note)}</div>` : ""}
  <div class="foot">This is a computer-generated salary slip and does not need a signature.</div>
</div>
<div class="noprint" style="text-align:center;margin-top:16px"><button onclick="window.print()" style="padding:10px 18px;border-radius:10px;border:0;background:#16a34a;color:#fff;font-weight:600;cursor:pointer">Print / Save as PDF</button></div>
</body></html>`;
}

/** Opens the slip in a new tab ready to print (Save as PDF). */
export function openSalarySlip(s: SlipSnapshot) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Allow pop-ups for this site to open the salary slip.");
  w.document.open();
  w.document.write(salarySlipHtml(s));
  w.document.close();
}
