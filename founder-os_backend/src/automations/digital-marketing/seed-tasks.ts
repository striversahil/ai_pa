/**
 * GENERATED from data/digital_marketing_follow_up.json.
 * Do not hand-edit — re-run generator. Fresh-DB fallback seed used by
 * ensureSeedTemplates() (live seed lives in migrations/0038).
 */
export interface DigitalMarketingSeedTask {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  ruleType: string;
  ruleJson: string;
  rawText: string | null;
  isShared: boolean;
  employeeRaw: string | null;
  department: string | null;
  sheetStatus: string | null;
  metricsSchema: string | null;
  active: boolean;
  order: number;
}

export const SEED_TASKS: DigitalMarketingSeedTask[] = [
  {
    "id": "dmm-01",
    "title": "Create a sheet containing all account details for Facebook, Instagram, Google Business Profile, and LinkedIn.",
    "description": null,
    "frequency": "daily",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "not_applicable",
    "ruleJson": "{\"type\":\"not_applicable\"}",
    "rawText": null,
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": null,
    "active": true,
    "order": 1
  },
  {
    "id": "dmm-02",
    "title": "Company Pages – Collateral Posting Facebook: Publish Post",
    "description": null,
    "frequency": "weekly",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "multi_occurrence",
    "ruleJson": "{\"type\":\"multi_occurrence\",\"occurrences\":[{\"type\":\"weekday\",\"weekday\":\"Monday\",\"occurrence\":\"every\"},{\"type\":\"weekday\",\"weekday\":\"Wednesday\",\"occurrence\":\"every\"}]}",
    "rawText": "Monday, Wednesday",
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": null,
    "active": true,
    "order": 2
  },
  {
    "id": "dmm-03",
    "title": "Company Pages – Collateral Posting Instagram: Publish Post",
    "description": null,
    "frequency": "weekly",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "multi_occurrence",
    "ruleJson": "{\"type\":\"multi_occurrence\",\"occurrences\":[{\"type\":\"weekday\",\"weekday\":\"Tuesday\",\"occurrence\":\"every\"},{\"type\":\"weekday\",\"weekday\":\"Thursday\",\"occurrence\":\"every\"}]}",
    "rawText": "Tuesday, Thursday",
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": null,
    "active": true,
    "order": 3
  },
  {
    "id": "dmm-04",
    "title": "Company Pages – Collateral Posting Google Business Profile: Publish Post",
    "description": null,
    "frequency": "weekly",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "multi_occurrence",
    "ruleJson": "{\"type\":\"multi_occurrence\",\"occurrences\":[{\"type\":\"weekday\",\"weekday\":\"Wednesday\",\"occurrence\":\"every\"},{\"type\":\"weekday\",\"weekday\":\"Friday\",\"occurrence\":\"every\"}]}",
    "rawText": "Wednesday, Friday",
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": null,
    "active": true,
    "order": 4
  },
  {
    "id": "dmm-05",
    "title": "Company Pages – Collateral Posting LinkedIn: Publish Post",
    "description": null,
    "frequency": "weekly",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "multi_occurrence",
    "ruleJson": "{\"type\":\"multi_occurrence\",\"occurrences\":[{\"type\":\"weekday\",\"weekday\":\"Thursday\",\"occurrence\":\"every\"},{\"type\":\"weekday\",\"weekday\":\"Saturday\",\"occurrence\":\"every\"}]}",
    "rawText": "Thursday, Saturday",
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": null,
    "active": true,
    "order": 5
  },
  {
    "id": "dmm-06",
    "title": "Meta Ads Run",
    "description": "Saturday starts the campaign (category + amount + from/to); daily box stays open during the run to capture inquiries/leads.",
    "frequency": "daily",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "not_applicable",
    "ruleJson": "{\"type\":\"not_applicable\"}",
    "rawText": null,
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": "[{\"key\":\"category\",\"label\":\"Category\",\"type\":\"select\",\"options\":[\"Wire Mesh\",\"Transmission Accessories\",\"Roller Mill Accessories\",\"Purifier Accessories\",\"Plansifter Accessories\",\"Perforated Sheets\",\"Miscellaneous\",\"Magnets\",\"Lab Equipments\",\"Conveying Accessories\",\"Pipe Accessories\"]},{\"key\":\"amountSpent\",\"label\":\"Amount Spent (₹)\",\"type\":\"number\"},{\"key\":\"fromDate\",\"label\":\"Ad Run From\",\"type\":\"date\"},{\"key\":\"toDate\",\"label\":\"Ad Run To\",\"type\":\"date\"},{\"key\":\"inquiries\",\"label\":\"No of Inquiries Generated\",\"type\":\"number\"},{\"key\":\"leads\",\"label\":\"Leads Generated\",\"type\":\"number\"}]",
    "active": true,
    "order": 6
  },
  {
    "id": "dmm-07",
    "title": "B2B websites optimization",
    "description": null,
    "frequency": "daily",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "not_applicable",
    "ruleJson": "{\"type\":\"not_applicable\"}",
    "rawText": null,
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": "[{\"key\":\"aliBaba\",\"label\":\"Ali Baba - No of Leads Generated\",\"type\":\"number\"},{\"key\":\"eExporter\",\"label\":\"E exporter - No of Leads Generated\",\"type\":\"number\"},{\"key\":\"indiaMart\",\"label\":\"India Mart - No of Leads Generated\",\"type\":\"number\"},{\"key\":\"tradeIndia\",\"label\":\"Trade India - No of Leads Generated\",\"type\":\"number\"}]",
    "active": true,
    "order": 7
  },
  {
    "id": "dmm-08",
    "title": "Whatsapp Marketing",
    "description": null,
    "frequency": "daily",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "not_applicable",
    "ruleJson": "{\"type\":\"not_applicable\"}",
    "rawText": null,
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": "[{\"key\":\"dataSource\",\"label\":\"Data used for marketing (source / list)\",\"type\":\"text\"},{\"key\":\"amountSpent\",\"label\":\"Amount Spent (₹)\",\"type\":\"number\"},{\"key\":\"whatsappCount\",\"label\":\"Whatsapp Marketing Count\",\"type\":\"number\"},{\"key\":\"whatsappLeads\",\"label\":\"Leads Generated Count\",\"type\":\"number\"}]",
    "active": true,
    "order": 8
  },
  {
    "id": "dmm-09",
    "title": "Email Marketing",
    "description": null,
    "frequency": "daily",
    "ownerRole": "manager",
    "dueDay": null,
    "dueMonth": null,
    "ruleType": "not_applicable",
    "ruleJson": "{\"type\":\"not_applicable\"}",
    "rawText": null,
    "isShared": false,
    "employeeRaw": "Digital Marketing Manager",
    "department": "Digital Marketing",
    "sheetStatus": "Ok",
    "metricsSchema": "[{\"key\":\"dataSource\",\"label\":\"Data used for marketing (source / list)\",\"type\":\"text\"},{\"key\":\"emailCount\",\"label\":\"Email Marketing Count\",\"type\":\"number\"},{\"key\":\"emailLeads\",\"label\":\"Leads Generated Count\",\"type\":\"number\"}]",
    "active": true,
    "order": 9
  }
];
