import type { HrSalarySlip } from "./types";
import { monthLabel, shortDate } from "./format";

function inr(value: number): string {
  return `Rs. ${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export async function downloadSalarySlipPdf(slip: HrSalarySlip): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 15;
  const right = pageWidth - 15;
  const mid = pageWidth / 2;
  let y = 18;

  const ensure = (space: number) => {
    if (y + space > pageHeight - 16) {
      doc.addPage();
      y = 18;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("SALARY SLIP", left, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(monthLabel(slip.month), right, y, { align: "right" });
  y += 3;
  doc.setDrawColor(210);
  doc.line(left, y, right, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(slip.employeeName || "Employee", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const role = [slip.designation, slip.department].filter(Boolean).join(" - ");
  if (role) doc.text(role, left, y + 5);
  if (slip.employeeCode) doc.text(`Code: ${slip.employeeCode}`, right, y, { align: "right" });
  doc.text(`Status: ${slip.status.toUpperCase()}`, right, y + 5, { align: "right" });
  y += 13;

  const box = (x: number, width: number, title: string, lines: string[]) => {
    doc.setDrawColor(225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, width, 7 + lines.length * 5, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title, x + 4, y + 5);
    doc.setFont("helvetica", "normal");
    lines.forEach((line, i) => doc.text(line, x + 4, y + 10 + i * 5));
  };
  const colWidth = (right - left - 6) / 2;
  const leftLines = [
    `Joining date: ${slip.employee?.joiningDate ? shortDate(slip.employee.joiningDate) : "-"}`,
    `Working days: ${slip.workingDays}`,
    `Payable days: ${slip.payableDays} / ${slip.eligibleDays}`,
  ];
  const rightLines = [
    `Present: ${slip.presentDays}   Half days: ${slip.halfDays}`,
    `Paid leave: ${slip.paidLeaveDays}   Unpaid leave: ${slip.unpaidLeaveDays}`,
    `Absent: ${slip.absentDays}   Unmarked: ${slip.unmarkedDays}`,
  ];
  box(left, colWidth, "EMPLOYMENT", leftLines);
  box(mid + 3, colWidth, "ATTENDANCE", rightLines);
  y += 7 + 3 * 5 + 8;

  const tableWidth = (right - left - 6) / 2;
  const drawTable = (x: number, width: number, title: string, lines: { name: string; amount: number }[], total: number, totalLabel: string) => {
    doc.setDrawColor(225);
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, width, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title, x + 3, y + 4.8);
    doc.text("Amount", x + width - 3, y + 4.8, { align: "right" });
    let rowY = y + 7;
    doc.setFont("helvetica", "normal");
    for (const line of lines) {
      doc.setDrawColor(238);
      doc.line(x, rowY, x + width, rowY);
      rowY += 6;
      doc.text(line.name || "-", x + 3, rowY - 1.8);
      doc.text(inr(line.amount), x + width - 3, rowY - 1.8, { align: "right" });
    }
    doc.setFont("helvetica", "bold");
    doc.line(x, rowY, x + width, rowY);
    rowY += 6;
    doc.text(totalLabel, x + 3, rowY - 1.8);
    doc.text(inr(total), x + width - 3, rowY - 1.8, { align: "right" });
    return rowY - y;
  };
  const grossTotal = slip.earnings.reduce((s, l) => s + Number(l.amount || 0), 0);
  const deductionTotal = slip.deductions.reduce((s, l) => s + Number(l.amount || 0), 0);
  const leftHeight = drawTable(left, tableWidth, "EARNINGS", slip.earnings, grossTotal, "Gross");
  const rightHeight = drawTable(mid + 3, tableWidth, "DEDUCTIONS", slip.deductions, deductionTotal, "Configured");
  y += Math.max(leftHeight, rightHeight) + 7;

  ensure(38);
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(left, y, right - left, 32, 2, 2, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rows = [
    ["Full monthly gross", inr(slip.fullMonthlyGross)],
    ["Earned gross", inr(slip.earnedGross)],
    ["Absence deduction", `- ${inr(slip.absenceDeduction)}`],
    ["Other deductions", `- ${inr(slip.componentDeductions)}`],
  ];
  rows.forEach(([name, value], i) => {
    doc.text(name, left + 5, y + 7 + i * 5);
    doc.text(value, right - 5, y + 7 + i * 5, { align: "right" });
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("NET PAY", left + 5, y + 28);
  doc.text(inr(slip.netPay), right - 5, y + 28, { align: "right" });
  y += 39;

  if (slip.notes) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Notes", left, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(slip.notes, right - left);
    doc.text(lines, left, y + 5);
    y += 5 + lines.length * 4;
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, left, pageHeight - 10);
  doc.text("System generated salary slip", right, pageHeight - 10, { align: "right" });
  const safeName = (slip.employeeName || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  doc.save(`salary-slip-${safeName}-${slip.month}.pdf`);
}
