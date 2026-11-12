// Extracted verbatim from DigitalMarketingAds.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingAds.tsx re-exports everything public here, so existing imports keep working.


export type AdType = 'google' | 'meta' | 'whatsapp' | 'email' | 'twitter' | 'other';

export type AdStatus = 'planned' | 'live' | 'completed';

export interface AdAttachment {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface AdRow {
  id: string;
  type: AdType;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  amountSpent: number;
  leads: number;
  enquiries: number;
  dataDescription: string;
  status: AdStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AdAttachment[];
}

export interface AdsPayload {
  rows: AdRow[];
  total: number;
  generatedAt: string;
}
