// member-documents.ts — the HR document checklist API.
import type { HrLookup } from "@/hr/lookups";

export interface MemberDocument {
  id: string;
  documentTypeId: string;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string | null;
  url: string;
}

export interface MemberDocumentType extends HrLookup {
  documents: MemberDocument[];
  uploaded: number;
}

export interface MemberDocumentsPayload {
  member: { id: string; name: string; designation: string | null; department: string | null };
  documentTypes: MemberDocumentType[];
  documents: MemberDocument[];
  completeness: { required: number; uploaded: number };
}
