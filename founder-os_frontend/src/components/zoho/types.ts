export interface Classification {
  intentScore?: number;
  reasoning?: string;
  summary?: string;
  salesAgent?: string;
  meaningfulUpdate?: boolean;
  notAnswering?: string;
  movingSlow?: string;
  underDiscussion?: string;
  confirm?: string;
  [key: string]: unknown;
}

export interface Comment {
  commentId: string;
  estimateId: string;
  description: string;
  commentedBy?: string;
  date?: string;
  dateDescription?: string;
  dateFormatted?: string;
}

export interface Estimate {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  total: number;
  date?: string;
  status: string;
  classification?: Classification;
  comments?: Comment[];
  [key: string]: unknown;
}

export interface FilterRule {
  id: number;
  field: string;
  operator: "is" | "is_not";
}

export interface Movement {
  accepted: Estimate[];
  declined: Estimate[];
  stillPending: Estimate[];
  newCreated: Estimate[];
  baselineCount: number;
  baselineValue: number;
}