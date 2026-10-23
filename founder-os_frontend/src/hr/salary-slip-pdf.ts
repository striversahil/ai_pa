import type { jsPDF as JsPdf } from "jspdf";
import type { HrSalarySlip } from "./types";
import { monthLabel, shortDate } from "./format";

const COMPANY = "BRINDAVAN UDYOG INDIA";
const COMPANY_TITLE = "Brindavan Udyog India";
const LOGO_PATH = "/bui_logo.png";

type Rgb = readonly [number, number, number];

const NAVY: Rgb = [15, 52, 86];
const BLUE: Rgb = [33, 92, 145];
const RED: Rgb = [204, 54, 50];
const SLATE: Rgb = [71, 85, 105];
const MUTED: Rgb = [100, 116, 139];
const BORDER: Rgb = [219, 227, 236];
const LIGHT: Rgb = [246, 249, 252];
const STRIPE: Rgb = [250, 252, 254];
const WHITE: Rgb = [255, 255, 255];
const GREEN: Rgb = [15, 118, 110];
const AMBER: Rgb = [180, 108, 16];

function fill(doc: JsPdf, color: Rgb): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

function stroke(doc: JsPdf, color: Rgb): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function textColor(doc: JsPdf, color: Rgb): void {
  doc.setTextColor(color[0], color[1], color[2]);
}

function inr(value: number): string {
  return `Rs. ${(Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function days(value: number): string {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function safeDate(value: string | null | undefined): string {
  return value ? shortDate(String(value).slice(0, 10)) : "—";
}

function safeDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeDate(value);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fitText(doc: JsPdf, value: string, width: number): string {
  const text = String(value || "—");
  if (doc.getTextWidth(text) <= width) return text;
  let shortened = text;
  while (shortened.length > 1 && doc.getTextWidth(`${shortened}...`) > width) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch(LOGO_PATH, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function statusTone(status: string): { bg: Rgb; fg: Rgb } {
  if (status === "paid") return { bg: [232, 247, 244], fg: GREEN };
  if (status === "finalized") return { bg: [233, 241, 250], fg: BLUE };
  return { bg: [255, 247, 230], fg: AMBER };
}

function drawSectionTitle(doc: JsPdf, text: string, y: number, left: number, right: number): void {
  fill(doc, RED);
  doc.rect(left, y - 3, 2.5, 3.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  textColor(doc, NAVY);
  doc.text(text, left + 5, y);
  const lineStart = left + 7 + doc.getTextWidth(text);
  stroke(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.line(lineStart, y - 1.1, right, y - 1.1);
}

function drawStatusPill(doc: JsPdf, status: string, right: number, top: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const label = status.toUpperCase();
  const width = doc.getTextWidth(label) + 8;
  const tone = statusTone(status);
  fill(doc, tone.bg);
  doc.roundedRect(right - width, top, width, 6, 3, 3, "F");
  textColor(doc, tone.fg);
  doc.text(label, right - width / 2, top + 4.1, { align: "center" });
}

function drawHeader(
  doc: JsPdf,
  slip: HrSalarySlip,
  logo: string | null,
  left: number,
  right: number,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  fill(doc, RED);
  doc.rect(0, 0, 48, 4, "F");
  fill(doc, BLUE);
  doc.rect(48, 0, pageWidth - 48, 4, "F");

  if (logo) {
    doc.addImage(logo, "PNG", left, 8, 32, 32);
  } else {
    fill(doc, NAVY);
    doc.roundedRect(left, 9, 30, 18, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    textColor(doc, WHITE);
    doc.text("BUI", left + 15, 20.5, { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  textColor(doc, NAVY);
  doc.text(COMPANY, left + 37, 19);
  doc.setFontSize(9);
  textColor(doc, RED);
  doc.text("SALARY SLIP", left + 37, 27);

  drawStatusPill(doc, slip.status, right, 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  textColor(doc, MUTED);
  doc.text("PAY PERIOD", right, 24, { align: "right" });
  doc.setFontSize(11);
  textColor(doc, NAVY);
  doc.text(monthLabel(slip.month), right, 30, { align: "right" });

  stroke(doc, BORDER);
  doc.setLineWidth(0.3);
  doc.line(left, 43, right, 43);
  return 50;
}

function drawEmployeeCard(
  doc: JsPdf,
  slip: HrSalarySlip,
  y: number,
  left: number,
  right: number,
): number {
  const width = right - left;
  const height = 28;
  fill(doc, LIGHT);
  stroke(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(left, y, width, height, 2, 2, "FD");

  const leftWidth = 91;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  textColor(doc, NAVY);
  doc.text(fitText(doc, slip.employeeName || "Employee", leftWidth), left + 5, y + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.3);
  textColor(doc, SLATE);
  const role = [slip.designation, slip.department].filter(Boolean).join("  |  ");
  doc.text(fitText(doc, role || "—", leftWidth), left + 5, y + 15.5);

  doc.setFontSize(7.5);
  textColor(doc, MUTED);
  doc.text("Employee code", left + 5, y + 22);
  doc.setFont("helvetica", "bold");
  textColor(doc, NAVY);
  doc.text(slip.employeeCode || "—", left + 25, y + 22);

  stroke(doc, BORDER);
  doc.line(left + 100, y + 5, left + 100, y + height - 5);

  const colOne = left + 106;
  const colTwo = left + 148;
  const labelSize = 6.4;
  const valueSize = 8;
  const drawField = (x: number, rowY: number, label: string, value: string, maxWidth: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(labelSize);
    textColor(doc, MUTED);
    doc.text(label, x, rowY);
    doc.setFontSize(valueSize);
    textColor(doc, NAVY);
    doc.text(fitText(doc, value, maxWidth), x, rowY + 4.3);
  };

  drawField(colOne, y + 8, "JOINING DATE", safeDate(slip.employee?.joiningDate), 31);
  drawField(colOne, y + 18, "DEPARTMENT", slip.department || "—", 31);
  drawField(colTwo, y + 8, "EMPLOYEE CODE", slip.employeeCode || "—", 31);
  const paymentDate = slip.status === "paid"
    ? safeDate(slip.paidAt)
    : slip.status === "finalized"
      ? safeDate(slip.finalizedAt)
      : "Draft";
  drawField(colTwo, y + 18, slip.status === "paid" ? "PAID ON" : "SLIP STATUS", paymentDate, 31);

  return y + height;
}

function drawDaysCard(
  doc: JsPdf,
  slip: HrSalarySlip,
  y: number,
  left: number,
  right: number,
): number {
  const cardWidth = 58;
  const cardHeight = 36;
  fill(doc, NAVY);
  doc.roundedRect(left, y, cardWidth, cardHeight, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(193, 214, 236);
  doc.text("DAYS PAID", left + 6, y + 8);

  doc.setFontSize(22);
  textColor(doc, WHITE);
  doc.text(days(slip.payableDays), left + 6, y + 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  doc.setTextColor(193, 214, 236);
  const eligible = slip.eligibleDays === slip.workingDays
    ? `of ${days(slip.workingDays)} working days`
    : `of ${days(slip.eligibleDays)} eligible days (${days(slip.workingDays)} working)`;
  doc.text(fitText(doc, eligible, cardWidth - 10), left + 6, y + 29);

  const gridLeft = left + cardWidth + 4;
  const gridWidth = right - gridLeft;
  const gap = 2;
  const cellWidth = (gridWidth - gap * 3) / 4;
  const cellHeight = 16.5;
  const metrics: { label: string; value: string; color: Rgb | null }[] = [
    { label: "PRESENT", value: days(slip.presentDays), color: null },
    { label: "HALF DAYS", value: days(slip.halfDays), color: null },
    { label: "PAID LEAVE", value: days(slip.paidLeaveDays), color: null },
    { label: "HOLIDAYS", value: days(slip.holidayDays), color: null },
    { label: "ABSENT", value: days(slip.absentDays), color: RED },
    { label: "UNPAID LEAVE", value: days(slip.unpaidLeaveDays), color: null },
    { label: "UNMARKED", value: days(slip.unmarkedDays), color: slip.unmarkedDays > 0 ? AMBER : null },
    { label: "PER DAY", value: inr(slip.perDay), color: BLUE },
  ];

  metrics.forEach((metric, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const x = gridLeft + column * (cellWidth + gap);
    const cellY = y + row * (cellHeight + 2);
    fill(doc, WHITE);
    stroke(doc, BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, cellY, cellWidth, cellHeight, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    textColor(doc, MUTED);
    doc.text(metric.label, x + 3, cellY + 5);
    doc.setFontSize(metric.label === "PER DAY" ? 7.2 : 10);
    textColor(doc, metric.color ?? NAVY);
    doc.text(fitText(doc, metric.value, cellWidth - 6), x + 3, cellY + 12.3);
  });

  return y + cardHeight;
}

function tableHeight(lineCount: number): number {
  return 7 + Math.max(1, lineCount) * 6 + 8;
}

function drawMoneyTable(
  doc: JsPdf,
  x: number,
  y: number,
  width: number,
  title: string,
  lines: { name: string; amount: number }[],
  total: number,
  totalLabel: string,
): number {
  const height = tableHeight(lines.length);
  fill(doc, NAVY);
  doc.rect(x, y, width, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  textColor(doc, WHITE);
  doc.text(title, x + 4, y + 4.7);
  doc.text("AMOUNT", x + width - 4, y + 4.7, { align: "right" });

  let rowY = y + 7;
  if (lines.length === 0) {
    fill(doc, STRIPE);
    doc.rect(x, rowY, width, 6, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.4);
    textColor(doc, MUTED);
    doc.text("No entries", x + 4, rowY + 4);
    rowY += 6;
  } else {
    lines.forEach((line, index) => {
      if (index % 2 === 0) {
        fill(doc, STRIPE);
        doc.rect(x, rowY, width, 6, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      textColor(doc, SLATE);
      doc.text(fitText(doc, line.name || "—", width - 37), x + 4, rowY + 4);
      textColor(doc, NAVY);
      doc.text(inr(line.amount), x + width - 4, rowY + 4, { align: "right" });
      stroke(doc, BORDER);
      doc.setLineWidth(0.1);
      doc.line(x, rowY + 6, x + width, rowY + 6);
      rowY += 6;
    });
  }

  fill(doc, [233, 240, 247]);
  doc.rect(x, rowY, width, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  textColor(doc, NAVY);
  doc.text(totalLabel, x + 4, rowY + 5.2);
  doc.text(inr(total), x + width - 4, rowY + 5.2, { align: "right" });

  stroke(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.rect(x, y, width, height);
  return height;
}

function drawSummary(
  doc: JsPdf,
  slip: HrSalarySlip,
  y: number,
  left: number,
  right: number,
): number {
  const width = right - left;
  const height = 44;
  fill(doc, LIGHT);
  stroke(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.roundedRect(left, y, width, height, 2, 2, "FD");

  const fullGross = Number(slip.fullMonthlyGross) || Number(slip.monthlyGross) || 0;
  const proratedGross = Number(slip.monthlyGross) || fullGross;
  const proration = fullGross - proratedGross;
  const rows: { label: string; value: string; strong?: boolean; negative?: boolean }[] = [
    { label: "Full monthly gross", value: inr(fullGross) },
  ];
  if (Math.abs(proration) >= 0.01) {
    rows.push({ label: "Eligible-day proration", value: `- ${inr(proration)}`, negative: true });
  }
  rows.push(
    { label: "Absence / unpaid days", value: `- ${inr(slip.absenceDeduction)}`, negative: true },
    { label: "Salary deductions", value: `- ${inr(slip.componentDeductions)}`, negative: true },
    { label: "Total deductions", value: inr(slip.totalDeductions), strong: true },
  );

  const valueRight = left + Math.min(112, width - 66);
  let rowY = y + 8.5;
  rows.forEach((row) => {
    doc.setFont("helvetica", row.strong ? "bold" : "normal");
    doc.setFontSize(row.strong ? 8.4 : 7.9);
    textColor(doc, row.strong ? NAVY : SLATE);
    doc.text(row.label, left + 6, rowY);
    doc.setFont("helvetica", "bold");
    textColor(doc, row.negative ? RED : NAVY);
    doc.text(row.value, valueRight, rowY, { align: "right" });
    if (row.strong) {
      stroke(doc, BORDER);
      doc.setLineWidth(0.2);
      doc.line(left + 6, rowY - 3.2, valueRight, rowY - 3.2);
    }
    rowY += 6.1;
  });

  const netX = left + width - 65;
  const netWidth = 61;
  fill(doc, NAVY);
  doc.roundedRect(netX, y + 4, netWidth, height - 8, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.3);
  doc.setTextColor(193, 214, 236);
  doc.text("NET PAY", netX + 6, y + 12);
  doc.setFontSize(14.5);
  textColor(doc, WHITE);
  doc.text(fitText(doc, inr(slip.netPay), netWidth - 12), netX + 6, y + 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  doc.setTextColor(193, 214, 236);
  doc.text(`for ${days(slip.payableDays)} paid days`, netX + 6, y + 32);
  doc.text(`Per day ${inr(slip.perDay)}`, netX + 6, y + 37);

  return y + height;
}

function drawContinuationHeader(doc: JsPdf, slip: HrSalarySlip, left: number, right: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  fill(doc, NAVY);
  doc.rect(0, 0, pageWidth, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  textColor(doc, NAVY);
  doc.text(COMPANY, left, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  textColor(doc, MUTED);
  doc.text(
    fitText(doc, `${slip.employeeName}  |  Salary slip  |  ${monthLabel(slip.month)}`, right - left - 58),
    right,
    14,
    { align: "right" },
  );
  stroke(doc, BORDER);
  doc.setLineWidth(0.2);
  doc.line(left, 18, right, 18);
}

function drawFooters(doc: JsPdf, slip: HrSalarySlip, left: number, right: number): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    stroke(doc, BORDER);
    doc.setLineWidth(0.2);
    doc.line(left, pageHeight - 16, right, pageHeight - 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    textColor(doc, NAVY);
    doc.text(`${COMPANY_TITLE}  |  Confidential`, left, pageHeight - 11);
    doc.setFont("helvetica", "normal");
    textColor(doc, MUTED);
    doc.text(`Page ${page} of ${total}`, right, pageHeight - 11, { align: "right" });
    doc.setFontSize(6.2);
    doc.text(
      `Generated ${safeDateTime(new Date().toISOString())}`,
      left,
      pageHeight - 6,
    );
    doc.text("Computer-generated salary slip", right, pageHeight - 6, { align: "right" });
  }
}

export async function buildSalarySlipPdf(slip: HrSalarySlip, logo: string | null = null): Promise<JsPdf> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({
    title: `Salary Slip - ${slip.employeeName} - ${monthLabel(slip.month)}`,
    subject: "Salary slip",
    author: COMPANY_TITLE,
    creator: COMPANY_TITLE,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  const right = pageWidth - 14;
  const contentBottom = pageHeight - 22;
  let y = drawHeader(doc, slip, logo, left, right);

  const addPage = () => {
    doc.addPage();
    drawContinuationHeader(doc, slip, left, right);
    y = 25;
  };
  const ensure = (space: number) => {
    if (y + space > contentBottom) addPage();
  };

  drawSectionTitle(doc, "EMPLOYEE DETAILS", y, left, right);
  y = drawEmployeeCard(doc, slip, y + 4, left, right) + 10;

  drawSectionTitle(doc, "ATTENDANCE & PAID DAYS", y, left, right);
  y = drawDaysCard(doc, slip, y + 4, left, right) + 7;
  if (slip.unmarkedDays > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    textColor(doc, AMBER);
    doc.text(
      `${days(slip.unmarkedDays)} unmarked ${slip.unmarkedDays === 1 ? "day is" : "days are"} treated as absent.`,
      left,
      y,
    );
    y += 5;
  }
  y += 3;

  const grossTotal = slip.earnings.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const deductionTotal = slip.deductions.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const componentHeight = tableHeight(Math.max(slip.earnings.length, slip.deductions.length));
  ensure(componentHeight + 13);
  drawSectionTitle(doc, "SALARY COMPONENTS", y, left, right);
  const tableY = y + 4;
  const tableWidth = (right - left - 4) / 2;
  const earningsHeight = drawMoneyTable(
    doc,
    left,
    tableY,
    tableWidth,
    "EARNINGS",
    slip.earnings,
    grossTotal,
    "Full gross",
  );
  const deductionsHeight = drawMoneyTable(
    doc,
    left + tableWidth + 4,
    tableY,
    tableWidth,
    "DEDUCTIONS",
    slip.deductions,
    deductionTotal,
    "Component total",
  );
  y = tableY + Math.max(earningsHeight, deductionsHeight) + 11;

  ensure(57);
  drawSectionTitle(doc, "PAY SUMMARY", y, left, right);
  y = drawSummary(doc, slip, y + 4, left, right) + 10;

  if (slip.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    textColor(doc, SLATE);
    const noteLines = doc.splitTextToSize(slip.notes, right - left - 2);
    ensure(12 + noteLines.length * 3.6);
    drawSectionTitle(doc, "NOTES", y, left, right);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    textColor(doc, SLATE);
    doc.text(noteLines, left, y + 7);
  }

  drawFooters(doc, slip, left, right);
  return doc;
}

export async function downloadSalarySlipPdf(slip: HrSalarySlip): Promise<void> {
  const logo = await loadLogo();
  const doc = await buildSalarySlipPdf(slip, logo);
  const safeName = (slip.employeeName || "employee")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  doc.save(`Brindavan-Udyog-Salary-Slip-${safeName}-${slip.month}.pdf`);
}
