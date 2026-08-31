export interface Agent {
  id: string;
  name: string;
  initials: string;
  color: string;
  status: string;
}

export interface Activity {
  id: string;
  type: 'creation' | 'assignment' | 'status_change' | 'update';
  text: string;
  timestamp: string;
  agentId?: string;
}

export interface EnquiryRequirement {
  text: string;
  imageUrl?: string;
}

export interface Enquiry {
  id: string;
  estNumber: string;
  clientCompany: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  assignedAgentId: string;
  createdAt: string;
  activities: Activity[];
  imageUrls?: string[];
  additionalRequirements?: EnquiryRequirement[];
}

export interface Comment {
  id: string;
  enquiryId: string;
  agentId: string;
  content: string;
  createdAt: string;
  parentId: string | null;
  replies?: Comment[];
  imageUrl?: string;
}

export interface StoredData {
  enquiries: Enquiry[];
  comments: Comment[];
  agents: Agent[];
}

export const INITIAL_AGENTS: Agent[] = [
  { id: '1', name: 'Alice Vance', initials: 'AV', color: '#6366f1', status: 'active' },
  { id: '2', name: 'Bob Miller', initials: 'BM', color: '#10b981', status: 'active' },
  { id: '3', name: 'Charlie Song', initials: 'CS', color: '#f59e0b', status: 'active' },
  { id: '4', name: 'Diana Prince', initials: 'DP', color: '#f43f5e', status: 'active' },
];

// Legacy mock seed data removed — the enquiry tracker is fully backend-driven
// (/api/enquiries). INITIAL_AGENTS above is only a dev/fallback roster.
export const INITIAL_ENQUIRIES: Enquiry[] = [];
export const INITIAL_COMMENTS: Comment[] = [];
