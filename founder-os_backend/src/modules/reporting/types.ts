// types.ts — Reporting Sheet shapes (weekly management review).
//
// One row per department-section per period; the payload is schemaless JSON so
// sections gain/lose metrics without migrations. SECTION_DEFS is the single
// source of truth: it drives the entry form, the review display labels AND the
// server-side field whitelist (service.ts strips anything not listed here).
// The frontend mirrors these defs (frontend/src/reporting/fields.ts).

export type ReportDepartment = 'sales' | 'operations' | 'digital';

export type ReportSection =
  | 'telecaller' | 'data' | 'field'
  | 'scheduling' | 'outstanding' | 'dispatch' | 'stock' | 'feedback'
  | 'kingpin' | 'meta' | 'email-wa' | 'b2b' | 'ecommerce';

export const DEPARTMENTS: Array<{ dept: ReportDepartment; title: string; scope: string }> = [
  { dept: 'sales', title: 'Sales Head', scope: 'sales-head' },
  { dept: 'operations', title: 'CRM & Operations', scope: 'crm' },
  { dept: 'digital', title: 'Digital Marketing', scope: 'digital-marketing' },
];

export type ReportFieldType = 'number' | 'money' | 'text' | 'textarea';

export interface ReportFieldDef {
  key: string;
  label: string;
  type: ReportFieldType;
  hint?: string;
  /** Pre-filled from a live dashboard source (heads confirm or adjust). */
  auto?: boolean;
  /** Shown but never editable — a frozen source snapshot. */
  locked?: boolean;
}

export type ReportRowsKind = 'telecaller' | 'region-orders' | 'none';

export interface ReportSectionDef {
  section: ReportSection;
  title: string;
  blurb: string;
  fields: ReportFieldDef[];
  rows: ReportRowsKind;
  /** This section has a live source behind the Auto-fill button. */
  autofill: boolean;
}

export interface TelecallerRow {
  name: string;
  connected: number;
  leads: number;
}

export interface RegionOrderRow {
  region: string;
  orders: number;
  value: number;
}

export const SECTION_DEFS: Record<ReportDepartment, ReportSectionDef[]> = {
  sales: [
    {
      section: 'telecaller',
      title: 'A. Telecaller Performance',
      blurb: 'Connected calls and leads per telecaller, plus region-wise orders received.',
      rows: 'telecaller',
      autofill: true,
      fields: [
        { key: 'notes', label: 'Notes', type: 'textarea', hint: 'Anything the review should call out' },
      ],
    },
    {
      section: 'data',
      title: 'B. Data Consumption',
      blurb: 'Weekly data consumed, lead status split and follow-up position.',
      rows: 'none',
      autofill: true,
      fields: [
        { key: 'leadsDistributed', label: 'Leads / data distributed', type: 'number', hint: 'Fresh records handed to the floor this week' },
        { key: 'statusConverted', label: 'Converted', type: 'number', auto: true },
        { key: 'statusInProgress', label: 'In progress', type: 'number', auto: true },
        { key: 'statusLost', label: 'Lost', type: 'number', auto: true },
        { key: 'followupLeads', label: 'On follow-up', type: 'number', auto: true },
        { key: 'pendingScheduled', label: 'Pending scheduled (overdue)', type: 'number', auto: true },
        { key: 'notes', label: 'Follow-up performance notes', type: 'textarea' },
      ],
    },
    {
      section: 'field',
      title: 'C. Field Staff Performance',
      blurb: 'Mill visits, orders from the field and tour expenses. No live source — entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'millsVisited', label: 'Mills visited', type: 'number' },
        { key: 'newMillsVisited', label: 'New mills visited', type: 'number' },
        { key: 'ordersFromVisits', label: 'Orders from field visits', type: 'number' },
        { key: 'ordersValue', label: 'Order value', type: 'money' },
        { key: 'expenses', label: 'Expenses incurred', type: 'money', hint: 'Tour + stay + conveyance for the week' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
  operations: [
    {
      section: 'scheduling',
      title: 'A. Order Scheduling & Status',
      blurb: 'Scheduled vs pending vs partially-moved orders. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'scheduled', label: 'Orders scheduled', type: 'number' },
        { key: 'unscheduledPending', label: 'Unscheduled pending', type: 'number' },
        { key: 'partiallyScheduled', label: 'Partially scheduled', type: 'number' },
        { key: 'partiallyDispatched', label: 'Partially dispatched', type: 'number' },
        { key: 'dispatchedReceived', label: 'Dispatched & received by client', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    {
      section: 'outstanding',
      title: 'B. Outstanding & Collections',
      blurb: 'Outstanding = invoiced bills minus advance payments (live from the debtors ledger).',
      rows: 'none',
      autofill: true,
      fields: [
        { key: 'invoicedTotal', label: 'Invoiced bills', type: 'money', auto: true, locked: true },
        { key: 'advanceReceived', label: 'Advance payments', type: 'money', auto: true, locked: true },
        { key: 'netDue', label: 'Total outstanding', type: 'money', auto: true, locked: true, hint: 'Invoiced − advances, computed from the ledger' },
        { key: 'notes', label: 'Collection notes', type: 'textarea' },
      ],
    },
    {
      section: 'dispatch',
      title: 'C. Dispatch Team Performance',
      blurb: 'On-time / early / delayed / rescheduled / cancelled. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'onTime', label: 'Delivered on time', type: 'number' },
        { key: 'beforeTime', label: 'Delivered before time', type: 'number' },
        { key: 'delayed', label: 'Delayed', type: 'number' },
        { key: 'rescheduled', label: 'Rescheduled', type: 'number' },
        { key: 'cancelled', label: 'Cancelled', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    {
      section: 'stock',
      title: 'D. Stock Movement',
      blurb: 'Physical stock in vs out for the week. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'stockIn', label: 'Stock received (IN)', type: 'number' },
        { key: 'stockOut', label: 'Stock dispatched (OUT)', type: 'number' },
        { key: 'unit', label: 'Unit', type: 'text', hint: 'e.g. bags, MT, boxes' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    {
      section: 'feedback',
      title: 'E. Customer Feedback',
      blurb: 'Google reviews collected during the week. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'googleReviews', label: 'Google reviews collected', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
  ],
  digital: [
    {
      section: 'kingpin',
      title: 'A. Kingpin Algorithm',
      blurb: 'Business and enquiries via Kingpin. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'enquiries', label: 'Enquiries generated', type: 'number' },
        { key: 'businessValue', label: 'Business generated', type: 'money' },
        { key: 'converted', label: 'Converted to orders', type: 'number' },
        { key: 'natureOfWork', label: 'Nature of work received', type: 'textarea' },
        { key: 'progressStatus', label: 'Progress & conversion status', type: 'textarea' },
      ],
    },
    {
      section: 'meta',
      title: 'B. Meta Ads',
      blurb: 'Spend, inquiries and leads flow live from the marketing log; campaigns and business are entered by hand.',
      rows: 'none',
      autofill: true,
      fields: [
        { key: 'campaigns', label: 'Campaigns / ads run', type: 'number', hint: 'Count of campaigns live this week' },
        { key: 'spend', label: 'Amount spent', type: 'money', auto: true },
        { key: 'inquiries', label: 'Inquiries', type: 'number', auto: true },
        { key: 'leads', label: 'Leads / enquiries', type: 'number', auto: true },
        { key: 'businessValue', label: 'Business received', type: 'money' },
        { key: 'conversionNotes', label: 'Conversion results', type: 'textarea' },
      ],
    },
    {
      section: 'email-wa',
      title: 'C. Email & WhatsApp Marketing',
      blurb: 'Sends and leads flow live from the marketing log; campaign counts and database from the team.',
      rows: 'none',
      autofill: true,
      fields: [
        { key: 'emailCampaigns', label: 'Email campaigns', type: 'number' },
        { key: 'waCampaigns', label: 'WhatsApp campaigns', type: 'number' },
        { key: 'databaseUsed', label: 'Data / database used', type: 'text', hint: 'Which list or segment the campaigns went to' },
        { key: 'emailSent', label: 'Emails sent', type: 'number', auto: true },
        { key: 'emailLeads', label: 'Email leads', type: 'number', auto: true },
        { key: 'waSent', label: 'WhatsApp messages sent', type: 'number', auto: true },
        { key: 'waLeads', label: 'WhatsApp leads', type: 'number', auto: true },
        { key: 'businessConverted', label: 'Business converted', type: 'money' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    {
      section: 'b2b',
      title: 'D. B2B Website',
      blurb: 'Portal inquiries flow live from the marketing log; site work and conversions from the team.',
      rows: 'none',
      autofill: true,
      fields: [
        { key: 'workCompleted', label: 'Optimisation / development completed', type: 'textarea' },
        { key: 'alibaba', label: 'Alibaba inquiries', type: 'number', auto: true },
        { key: 'indiamart', label: 'IndiaMART inquiries', type: 'number', auto: true },
        { key: 'tradeindia', label: 'TradeIndia inquiries', type: 'number', auto: true },
        { key: 'eexporter', label: 'EExporter inquiries', type: 'number', auto: true },
        { key: 'converted', label: 'Enquiries converted to orders', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    {
      section: 'ecommerce',
      title: 'E. E-commerce (BUI + Silver Martini)',
      blurb: 'Platform business, orders and revenue. Entered by hand.',
      rows: 'none',
      autofill: false,
      fields: [
        { key: 'buiBusiness', label: 'BUI business', type: 'money' },
        { key: 'buiOrders', label: 'BUI orders', type: 'number' },
        { key: 'smBusiness', label: 'Silver Martini business', type: 'money' },
        { key: 'smOrders', label: 'Silver Martini orders', type: 'number' },
        { key: 'pendingOrders', label: 'Pending enquiries / orders', type: 'number' },
        { key: 'conversionStatus', label: 'Conversion status', type: 'textarea' },
      ],
    },
  ],
};

export function sectionDef(dept: ReportDepartment, section: ReportSection): ReportSectionDef | null {
  return (SECTION_DEFS[dept] ?? []).find((d) => d.section === section) ?? null;
}

export type ReportOrigin = 'manual' | 'autofill' | 'adjusted';

/** One saved section entry as served to the dashboard. */
export interface ReportEntryView {
  payload: Record<string, unknown>;
  telecallerRows: TelecallerRow[];
  regionOrders: RegionOrderRow[];
  origin: ReportOrigin;
  submittedByName: string;
  submittedAt: string;
}

export interface ReportSectionView {
  section: ReportSection;
  title: string;
  blurb: string;
  autofill: boolean;
  entry: ReportEntryView | null;
}

export interface ReportDepartmentView {
  dept: ReportDepartment;
  title: string;
  canEdit: boolean;
  sections: ReportSectionView[];
  submittedCount: number;
  sectionCount: number;
}

export interface ReportPeriodItem {
  key: string;
  label: string;
  from: string;
  to: string;
  current: boolean;
}

export interface ReportingPayload {
  period: string;
  periods: ReportPeriodItem[];
  editable: boolean;
  departments: ReportDepartmentView[];
}

/** Auto-fill suggestion: partial payload + which keys came from a live source. */
export interface AutofillResult {
  period: string;
  from: string;
  to: string;
  payload: Record<string, unknown>;
  telecallerRows: TelecallerRow[];
  regionOrders: RegionOrderRow[];
  autoKeys: string[];
  sources: string[];
}
