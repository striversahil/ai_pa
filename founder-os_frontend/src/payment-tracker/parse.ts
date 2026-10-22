/**
 * Payment Tracker — pure TSV paste parsers. NO framework/DB imports.
 * Excel's Excel-clipboard is tab-separated; values keep ₹ and Indian-digit
 * grouping; "—" (em dash) means blank; amounts in parentheses are negatives
 * (debit notes). Dates use mixed DD/Mon/YYYY, DD-Mon-YY forms.
 *
 * MIRROR: founder-os_backend/src/automations/payment-tracker/parse.ts —
 * authoritative import parser. Keep the two parse functions + number/date
 * helpers semantically identical (preview here vs import there must agree).
 */
import { normalizeCustomerName, normalizeInvoiceNo } from './types';

export interface DebtorRow {
  customerName: string;
  invoiceNo: string;
  invoiceDate: string | null;
  creditPeriodDays: number | null;
  dueDate: string | null;
  invoiceAmount: number;
  /** Parsed "Amount Received" (blank/— → 0). baseReceivedBlank flags absence. */
  baseReceived: number;
  baseReceivedBlank: boolean;
  balanceReceivable: number | null;
  contactName: string;
  contactPhone: string;
  contactMail: string;
  lastCallDate: string | null;
  callStatus: string;
  paymentStatus: string;
  remarks: string;
  accountStatus: string;
  mis: string;
  accountsRemarks: string;
  employee: string;
  state: string;
  region: string;
  ledgerLink: string;
}

export interface CollectionRow {
  collectionDate: string | null;
  customerName: string;
  invoiceNo: string;
  amount: number;
  mode: string;
  remarks: string;
  weekStart: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Clean a raw clipboard cell (strip stray CR and zero-width chars). */
function cell(s: string): string {
  return String(s ?? '')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/\r$/, '')
    .trim();
}

const BLANK = ['', '—', '–', '-', 'nil', 'na', 'n/a'];

/** Parse "₹ 12,690" / "(₹ 4,484)" / "3502" / "—" → number (null when blank). */
export function parseIndianMoney(raw: string): number | null {
  let s = cell(raw);
  if (BLANK.includes(s.toLowerCase().replace(/\.00$/, ''))) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()]/g, '').replace(/₹/g, '').replace(/rs\.?/gi, '').trim();
  s = s.replace(/,/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** Parse "23-Feb-2017" / "03/Feb/2017" / "22-Mar-21" / "2017-03-23" → ISO date. */
export function parseIndianDate(raw: string): string | null {
  const s = cell(raw).replace(/,/g, '');
  if (!s || BLANK.includes(s.toLowerCase())) return null;
  // ISO first
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]) - 1; const d = Number(m[3]);
    return validIso(y, mo, d);
  }
  m = s.match(/^(\d{1,2})\s*[-/. ]\s*([A-Za-z]{3,})\s*[-/. ]\s*(\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    const y = expandYear(m[3]);
    return validIso(y, mo, d);
  }
  // pure numeric dd/mm/yyyy (fallback; ambiguous dd-slash-mm form)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    // Indian convention is dd/mm
    return validIso(expandYear(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function expandYear(yRaw: string): number {
  const n = Number(yRaw);
  if (!Number.isFinite(n)) return NaN;
  if (n >= 100) return n;
  return n <= 69 ? 2000 + n : 1900 + n; // 17 → 2017, 99 → 1999
}

function validIso(y: number, mo: number, d: number): string | null {
  if (!Number.isFinite(y) || y < 1900 || y > 2999) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Split clipboard text into rows of cells: TSV primary, quoted-CSV fallback. */
function splitRows(text: string): string[][] {
  const lines = String(text ?? '').split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return [];
  const tabbed = nonEmpty.filter((l) => l.includes('\t')).length;
  if (tabbed >= nonEmpty.length * 0.6) {
    return nonEmpty.map((l) => l.split('\t').map(cell));
  }
  // Quote-aware CSV fallback (a header row determines field count).
  const csv = nonEmpty.map(parseCsvLine);
  return csv;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(cell);
}

/** Header-name → candidate-name matching (case/space-insensitive). */
function normalizeHeader(name: string): string {
  return name.toLowerCase().replace(/\(.*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Find the column whose normalized header equals a candidate, else contains it. */
function findColumn(headers: string[], candidates: string[]): number {
  const norm = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const c = normalizeHeader(cand);
    const exact = norm.indexOf(c);
    if (exact >= 0) return exact;
  }
  // Substring fallback: first header that contains the candidate.
  for (const cand of candidates) {
    const c = normalizeHeader(cand);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i].includes(c)) return i;
    }
  }
  return -1;
}

const DEBTOR_HEADERS = {
  customer: ['customer name', 'customer debtor', 'customer'],
  invoiceNo: ['invoice no', 'invoice no', 'invoice number', 'invoice'],
  invoiceDate: ['invoice date'],
  creditPeriod: ['credit period days', 'credit period'],
  dueDate: ['due date'],
  invoiceAmount: ['invoice amount', 'invoice amount', 'amount'],
  amountReceived: ['amount received'],
  balance: ['balance receivable', 'balance'],
  contactName: ['name'],
  contactPhone: ['number'],
  contactMail: ['mail id', 'mail'],
  lastCallDate: ['last call date', 'last call'],
  callStatus: ['call status'],
  paymentStatus: ['payment status'],
  remarks: ['remarks'],
  status: ['status'],
  mis: ['mis'],
  accountsRemarks: ['accounts remarks'],
  employee: ['employee'],
  state: ['state'],
  region: ['region'],
  ledgerLink: ['ledger link'],
} as const;

export interface ParseOutcome<T> {
  rows: T[];
  headerRowFound: boolean;
  totalLines: number;
  skipped: string[];
}

/** Parse the debtors ageing sheet paste → DebtorRow[]. */
export function parseDebtorsTsv(text: string): ParseOutcome<DebtorRow> {
  const grid = splitRows(text);
  const skipped: string[] = [];
  if (grid.length === 0) return { rows: [], headerRowFound: false, totalLines: 0, skipped };

  // Find the header row: contains a customer column AND an invoice-no column.
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const row = grid[i];
    const c = findColumn(row, DEBTOR_HEADERS.customer as unknown as string[]);
    const n = findColumn(row, DEBTOR_HEADERS.invoiceNo as unknown as string[]);
    if (c >= 0 && n >= 0) {
      headerIdx = i;
      cols = {
        customer: c,
        invoiceNo: n,
        invoiceDate: findColumn(row, DEBTOR_HEADERS.invoiceDate as unknown as string[]),
        creditPeriod: findColumn(row, DEBTOR_HEADERS.creditPeriod as unknown as string[]),
        dueDate: findColumn(row, DEBTOR_HEADERS.dueDate as unknown as string[]),
        invoiceAmount: findColumn(row, DEBTOR_HEADERS.invoiceAmount as unknown as string[]),
        amountReceived: findColumn(row, DEBTOR_HEADERS.amountReceived as unknown as string[]),
        balance: findColumn(row, DEBTOR_HEADERS.balance as unknown as string[]),
        contactName: findColumn(row, DEBTOR_HEADERS.contactName as unknown as string[]),
        contactPhone: findColumn(row, DEBTOR_HEADERS.contactPhone as unknown as string[]),
        contactMail: findColumn(row, DEBTOR_HEADERS.contactMail as unknown as string[]),
        lastCallDate: findColumn(row, DEBTOR_HEADERS.lastCallDate as unknown as string[]),
        callStatus: findColumn(row, DEBTOR_HEADERS.callStatus as unknown as string[]),
        paymentStatus: findColumn(row, DEBTOR_HEADERS.paymentStatus as unknown as string[]),
        remarks: findColumn(row, DEBTOR_HEADERS.remarks as unknown as string[]),
        accountStatus: findLastOf(row, ['status']),
        mis: findColumn(row, DEBTOR_HEADERS.mis as unknown as string[]),
        accountsRemarks: findColumn(row, DEBTOR_HEADERS.accountsRemarks as unknown as string[]),
        employee: findColumn(row, DEBTOR_HEADERS.employee as unknown as string[]),
        state: findColumn(row, DEBTOR_HEADERS.state as unknown as string[]),
        region: findColumn(row, DEBTOR_HEADERS.region as unknown as string[]),
        ledgerLink: findColumn(row, DEBTOR_HEADERS.ledgerLink as unknown as string[]),
      };
      break;
    }
  }
  const headerRowFound = headerIdx >= 0;

  const get = (row: string[], key: string): string => {
    const idx = cols[key];
    return idx >= 0 && idx < row.length ? cell(row[idx]) : '';
  };

  const rows: DebtorRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (headerRowFound && row.every((c) => c === '')) continue;
    const invoiceNo = normalizeInvoiceNo(get(row, 'invoiceNo'));
    const customerName = normalizeCustomerName(get(row, 'customer'));
    if (!invoiceNo || !customerName) {
      const lineNo = i + 1;
      skipped.push(`line ${lineNo}: missing ${!invoiceNo && !customerName ? 'customer + invoice no' : !invoiceNo ? 'invoice no' : 'customer name'}`);
      continue;
    }
    const invoiceDateRaw = get(row, 'invoiceDate');
    const credit = parseIndianMoney(get(row, 'creditPeriod'));
    const invoiceAmount = parseIndianMoney(get(row, 'invoiceAmount')) ?? 0;
    // Blank/— cell ⇒ baseReceived stays 0 with the BLANK flag set, so the
    // importer treats ledger collections as NOT yet included in the sheet.
    const receivedParsed = parseIndianMoney(get(row, 'amountReceived'));
    const balance = parseIndianMoney(get(row, 'balance'));

    // Derive the due date when the sheet doesn't provide one directly:
    // invoiceDate + creditPeriodDays.
    let dueDate = parseIndianDate(get(row, 'dueDate'));
    if (!dueDate && invoiceDateRaw) {
      const iid = parseIndianDate(invoiceDateRaw);
      if (iid && credit && credit > 0) {
        const dt = new Date(iid + 'T00:00:00Z');
        dt.setUTCDate(dt.getUTCDate() + Math.round(credit));
        dueDate = dt.toISOString().slice(0, 10);
      }
    }

    rows.push({
      customerName,
      invoiceNo,
      invoiceDate: parseIndianDate(invoiceDateRaw),
      creditPeriodDays: credit != null ? Math.round(credit) : null,
      dueDate,
      invoiceAmount,
      baseReceived: receivedParsed == null ? 0 : Math.abs(receivedParsed),
      baseReceivedBlank: receivedParsed == null || Math.abs(receivedParsed) <= 0.004,
      balanceReceivable: balance,
      contactName: get(row, 'contactName'),
      contactPhone: get(row, 'contactPhone'),
      contactMail: get(row, 'contactMail'),
      lastCallDate: parseIndianDate(get(row, 'lastCallDate')),
      callStatus: get(row, 'callStatus'),
      paymentStatus: get(row, 'paymentStatus'),
      remarks: get(row, 'remarks'),
      accountStatus: get(row, 'accountStatus'),
      mis: get(row, 'mis'),
      accountsRemarks: get(row, 'accountsRemarks'),
      employee: get(row, 'employee'),
      state: get(row, 'state'),
      region: get(row, 'region'),
      ledgerLink: get(row, 'ledgerLink'),
    });
  }
  return { rows, headerRowFound, totalLines: grid.length, skipped };
}

const COLLECTION_HEADERS = {
  collectionDate: ['collection date'],
  customer: ['customer name', 'customer debtor', 'customer'],
  invoiceNo: ['invoice no', 'invoice number', 'invoice'],
  amount: ['amount received'],
  mode: ['mode of receipt', 'mode'],
  remarks: ['remarks'],
  weekStart: ['collection week start', 'week start'],
} as const;

/** Parse the collections sheet paste → CollectionRow[]. */
export function parseCollectionsTsv(text: string): ParseOutcome<CollectionRow> {
  const grid = splitRows(text);
  const skipped: string[] = [];
  if (grid.length === 0) return { rows: [], headerRowFound: false, totalLines: 0, skipped };

  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 12); i++) {
    const row = grid[i];
    const c = findColumn(row, COLLECTION_HEADERS.customer as unknown as string[]);
    const a = findColumn(row, COLLECTION_HEADERS.amount as unknown as string[]);
    if (c >= 0 && a >= 0) {
      headerIdx = i;
      cols = {
        collectionDate: findColumn(row, COLLECTION_HEADERS.collectionDate as unknown as string[]),
        customer: c,
        invoiceNo: findColumn(row, COLLECTION_HEADERS.invoiceNo as unknown as string[]),
        amount: a,
        mode: findColumn(row, COLLECTION_HEADERS.mode as unknown as string[]),
        remarks: findColumn(row, COLLECTION_HEADERS.remarks as unknown as string[]),
        weekStart: findColumn(row, COLLECTION_HEADERS.weekStart as unknown as string[]),
      };
      break;
    }
  }
  const headerRowFound = headerIdx >= 0;

  const get = (row: string[], key: string): string => {
    const idx = cols[key];
    return idx >= 0 && idx < row.length ? cell(row[idx]) : '';
  };

  const rows: CollectionRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const customerName = normalizeCustomerName(get(row, 'customer'));
    const amount = parseIndianMoney(get(row, 'amount'));
    if (!customerName || amount == null) {
      skipped.push(`line ${i + 1}: missing ${!customerName && amount == null ? 'customer + amount' : !customerName ? 'customer name' : 'amount'}`);
      continue;
    }
    rows.push({
      collectionDate: parseIndianDate(get(row, 'collectionDate')),
      customerName,
      invoiceNo: normalizeInvoiceNo(get(row, 'invoiceNo')),
      amount,
      mode: get(row, 'mode'),
      remarks: get(row, 'remarks'),
      weekStart: get(row, 'weekStart'),
    });
  }
  return { rows, headerRowFound, totalLines: grid.length, skipped };
}

/** Last column whose header equals any of the aliases (e.g. SECOND "Remarks"). */
function findLastOf(headers: string[], aliases: string[]): number {
  let idx = -1;
  for (let i = 0; i < headers.length; i++) {
    const norm = headers[i].toLowerCase().replace(/\(.*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (aliases.some((a) => norm === a)) idx = i;
  }
  return idx;
}
