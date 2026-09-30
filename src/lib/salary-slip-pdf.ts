// Salary slip as a PDF (jsPDF + autotable, lazy-loaded), used to email the
// slip to an employee. The built-in PDF fonts have no ₹ glyph, so amounts are
// written "Rs. 28,200".

import { amountInWords } from "@/lib/payroll";
import { maskAccount, monthLabel, type SlipSnapshot } from "@/lib/salary-slip-html";

const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const salarySlipFileName = (s: SlipSnapshot) =>
  `Salary-Slip-${s.employee.name.replace(/\s+/g, "-")}-${s.month}.pdf`;

/** Base64 PDF (no data: prefix), ready to send as an email attachment. */
export async function salarySlipPdfBase64(s: SlipSnapshot): Promise<string> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const e = s.employee;

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(17, 24, 39);
  doc.text(s.company.name, M, 50);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(107, 114, 128);
  if (s.company.office) doc.text(s.company.office, M, 66);
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(17, 24, 39);
  doc.text("Salary Slip", W - M, 50, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(107, 114, 128);
  doc.text(monthLabel(s.month), W - M, 66, { align: "right" });

  const info = (pairs: [string, string | null][]) =>
    pairs.filter(([, v]) => v).map(([k, v]) => [k, v as string]);
  const left = info([
    ["Employee", e.name],
    ["Employee code", e.code],
    ["Designation", e.designation],
    ["Department", e.department],
    ["Date of joining", e.joining_date],
  ]);
  const right = info([
    ["PAN", e.pan],
    ["UAN", e.uan],
    ["ESI number", e.esi_number],
    ["Bank", [e.bank_name, maskAccount(e.bank_account_no)].filter(Boolean).join(" · ") || null],
    ["IFSC", e.bank_ifsc],
  ]);
  const rows = Math.max(left.length, right.length);
  autoTable(doc, {
    startY: 84,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { textColor: [107, 114, 128], cellWidth: 95 },
      2: { textColor: [107, 114, 128], cellWidth: 80 },
    },
    body: Array.from({ length: rows }, (_, i) => [
      left[i]?.[0] ?? "",
      left[i]?.[1] ?? "",
      right[i]?.[0] ?? "",
      right[i]?.[1] ?? "",
    ]),
  });

  const at = s.attendance;
  const hours = `${Math.floor(at.workedMinutes / 60)}h ${Math.round(at.workedMinutes % 60)}m`;
  autoTable(doc, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startY: (doc as any).lastAutoTable.finalY + 10,
    theme: "grid",
    styles: { fontSize: 8.5, halign: "center", cellPadding: 4 },
    headStyles: { fillColor: [240, 253, 244], textColor: [55, 65, 81], fontStyle: "normal" },
    head: [
      [
        "Days in month",
        "Paid days",
        "LOP days",
        "Present",
        "Hours",
        "Paid leave",
        "Unpaid leave",
        "Absent",
      ],
    ],
    body: [
      [
        String(s.slip.daysInMonth),
        fmtDays(s.slip.paidDays),
        fmtDays(s.slip.lopDays),
        String(at.present),
        hours,
        fmtDays(at.paidLeave),
        fmtDays(at.unpaidLeave),
        String(at.absent),
      ],
    ],
  });

  const earnings = s.slip.earnings.filter((l) => l.amount > 0 || l.full > 0);
  const deductions = s.slip.deductions.filter((l) => l.amount > 0);
  const n = Math.max(earnings.length, deductions.length, 1);
  autoTable(doc, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startY: (doc as any).lastAutoTable.finalY + 12,
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [22, 163, 74], textColor: 255 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 4: { halign: "right" } },
    head: [["Earnings", "Full month", "Earned", "Deductions", "Amount"]],
    body: [
      ...Array.from({ length: n }, (_, i) => {
        const a = earnings[i];
        const d = deductions[i];
        return [
          a?.label ?? "",
          a ? (a.full ? rs(a.full) : "-") : "",
          a ? rs(a.amount) : "",
          d?.label ?? "",
          d ? rs(d.amount) : "",
        ];
      }),
      [
        { content: "Gross earnings", styles: { fontStyle: "bold" } },
        { content: rs(s.slip.fixedGross), styles: { fontStyle: "bold" } },
        { content: rs(s.slip.grossEarnings), styles: { fontStyle: "bold" } },
        { content: "Total deductions", styles: { fontStyle: "bold" } },
        { content: rs(s.slip.totalDeductions), styles: { fontStyle: "bold" } },
      ],
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable.finalY + 22;
  doc.setFillColor(240, 253, 244).roundedRect(M, y, W - 2 * M, 50, 6, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(17, 24, 39);
  doc.text("Net pay", M + 14, y + 21);
  doc.setFontSize(16).setTextColor(21, 128, 61);
  doc.text(rs(s.slip.netPay), W - M - 14, y + 22, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(55, 65, 81);
  doc.text(amountInWords(s.slip.netPay), M + 14, y + 39);
  y += 66;
  if (s.note) {
    doc.setFontSize(9).setTextColor(55, 65, 81);
    doc.text(doc.splitTextToSize(`Note: ${s.note}`, W - 2 * M), M, y);
    y += 20;
  }
  doc.setFontSize(8).setTextColor(156, 163, 175);
  doc.text(
    "This is a computer-generated salary slip and does not need a signature.",
    W / 2,
    y + 10,
    { align: "center" },
  );

  return doc.output("datauristring").split(",")[1];
}
