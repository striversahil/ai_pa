// Mock Database for Brindavan Udyog (India) Enquiry Tracker
// Incorporates LocalStorage persistence with Tailored B2B Grain Milling products

export interface Agent {
  id: number;
  name: string;
  initials: string;
  color: string;
  status: string;
}

export interface Activity {
  id: string;
  type: 'creation' | 'assignment' | 'status_change';
  text: string;
  timestamp: string;
  agentId?: number;
}

export interface Enquiry {
  id: string;
  clientCompany: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  assignedAgentId: number;
  estimatedValue: number;
  createdAt: string;
  activities: Activity[];
  imageUrls?: string[];
}

export interface Comment {
  id: string;
  enquiryId: string;
  agentId: number;
  content: string;
  createdAt: string;
  parentId: string | null;
  replies?: Comment[];
  imageUrl?: string;
}

export const INITIAL_AGENTS: Agent[] = [
  { id: 1, name: "Alice Vance", initials: "AV", color: "#6366f1", status: "active" }, // Indigo
  { id: 2, name: "Bob Miller", initials: "BM", color: "#10b981", status: "active" }, // Emerald
  { id: 3, name: "Charlie Song", initials: "CS", color: "#f59e0b", status: "active" }, // Amber
  { id: 4, name: "Diana Prince", initials: "DP", color: "#f43f5e", status: "active" }  // Rose
];

export const INITIAL_ENQUIRIES: Enquiry[] = [
  {
    id: "enq-1",
    clientCompany: "Rajdhani Roller Flour Mills",
    contactName: "Sanjay Singhal",
    contactEmail: "sanjay.s@rajdhaniflour.in",
    contactPhone: "+91 98110 44521",
    title: "Plansifter Accessories - Sieve Pan Cleaners & Cotton Pads",
    description: "Inquiry for 12,000 units of plansifter sieve cleaners with metal rivets and 8,000 units of custom cotton pads. Urgent requirement for their Narela milling plant upgrade.",
    priority: "high",
    status: "proposal",
    assignedAgentId: 1,
    estimatedValue: 185000,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    imageUrls: ["/plansifter_cleaner.png", "/plansifter_pan_cleaner.png"],
    activities: [
      {
        id: "act-1-1",
        type: "creation",
        text: "Enquiry logged from website RFQ form.",
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-1-2",
        type: "assignment",
        text: "Assigned to plansifter components lead Alice Vance.",
        timestamp: new Date(Date.now() - 2.8 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 1
      },
      {
        id: "act-1-3",
        type: "status_change",
        text: "Status updated from 'New' to 'Contacted'.",
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 1
      },
      {
        id: "act-1-4",
        type: "status_change",
        text: "Status updated from 'Contacted' to 'Proposal'.",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 1
      }
    ]
  },
  {
    id: "enq-2",
    clientCompany: "Adani Wilmar Agri Products",
    contactName: "Vikram Rathore",
    contactEmail: "v.rathore@adaniwilmar.in",
    contactPhone: "+91 85112 99014",
    title: "Conveying Belts & Elevator Buckets Procurement",
    description: "Requires chemical-resistant conveyor belts (150m, 3-ply) and 450 units of high-density nylon elevator buckets for seed grain transport elevator.",
    priority: "medium",
    status: "qualified",
    assignedAgentId: 2,
    estimatedValue: 460000,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    activities: [
      {
        id: "act-2-1",
        type: "creation",
        text: "Enquiry created manually by Sales Desk.",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-2-2",
        type: "assignment",
        text: "Enquiry assigned to Bob Miller.",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-2-3",
        type: "status_change",
        text: "Status updated from 'New' to 'Qualified'.",
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 2
      }
    ]
  },
  {
    id: "enq-3",
    clientCompany: "Patanjali Food & Grains Division",
    contactName: "Rakesh Dev",
    contactEmail: "rakesh.dev@patanjaliagro.com",
    contactPhone: "+91 94120 78201",
    title: "High-Efficiency Magnetic Separator Drum Query",
    description: "Looking for an automatic high-intensity magnetic drum separator to remove ferrous contaminants from raw wheat supply lines.",
    priority: "low",
    status: "new",
    assignedAgentId: 3,
    estimatedValue: 320000,
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    activities: [
      {
        id: "act-3-1",
        type: "creation",
        text: "Enquiry submitted via Indiamart lead channel.",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  },
  {
    id: "enq-4",
    clientCompany: "ITC Agri Business Division",
    contactName: "Harish Iyer",
    contactEmail: "harish.iyer@itc.in",
    contactPhone: "+1 (555) 456-7890", // Kept standard format but Indian style
    title: "Bulk Order: Portable Bag Closing Machines (D-9 Series)",
    description: "Requesting quotation for 25 units of Portable Single Needle Bag Sewing Machines (D-9 model) with automatic oil pumps for grain sacking operations.",
    priority: "high",
    status: "negotiation",
    assignedAgentId: 4,
    estimatedValue: 275000,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    activities: [
      {
        id: "act-4-1",
        type: "creation",
        text: "Enquiry created by Industrial Sales Executive.",
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-4-2",
        type: "assignment",
        text: "Enquiry assigned to Diana Prince.",
        timestamp: new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-4-3",
        type: "status_change",
        text: "Status updated from 'New' to 'Contacted'.",
        timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 4
      },
      {
        id: "act-4-4",
        type: "status_change",
        text: "Status updated from 'Contacted' to 'Proposal'.",
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 4
      },
      {
        id: "act-4-5",
        type: "status_change",
        text: "Status updated from 'Proposal' to 'Negotiation'.",
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 4
      }
    ]
  },
  {
    id: "enq-5",
    clientCompany: "Cargill India Milling Operations",
    contactName: "Arun Mehra",
    contactEmail: "arun_mehra@cargill.co.in",
    contactPhone: "+91 99334 00192",
    title: "Stainless Steel Wire Mesh & Perforated Screens",
    description: "Custom size requirement. SS 304 wire mesh (various apertures) and perforated screens for heavy plansifter deck replacement.",
    priority: "high",
    status: "won",
    assignedAgentId: 2,
    estimatedValue: 690000,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    activities: [
      {
        id: "act-5-1",
        type: "creation",
        text: "Enquiry initialized from tender bid submission.",
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-5-2",
        type: "assignment",
        text: "Enquiry assigned to Bob Miller.",
        timestamp: new Date(Date.now() - 9.5 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "act-5-3",
        type: "status_change",
        text: "Status updated to 'Proposal'.",
        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 2
      },
      {
        id: "act-5-4",
        type: "status_change",
        text: "Status updated to 'Negotiation'.",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 2
      },
      {
        id: "act-5-5",
        type: "status_change",
        text: "Status updated to 'Won' (Closed Won).",
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        agentId: 2
      }
    ]
  }
];

export const INITIAL_COMMENTS: Comment[] = [
  {
    id: "com-1-1",
    enquiryId: "enq-1",
    agentId: 1,
    content: "Sent plansifter sieve cleaners technical drawing. Rajdhani requires food-grade certificates for the rubber and cotton pads. Requesting test certificate from production.",
    createdAt: new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: null
  },
  {
    id: "com-1-2",
    enquiryId: "enq-1",
    agentId: 2,
    content: "@Alice, plansifter cleaners with rivets have been approved by FDA before. I have shared our SGS certification PDF in the shared drive. That should satisfy Sanjay.",
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: "com-1-1"
  },
  {
    id: "com-1-3",
    enquiryId: "enq-1",
    agentId: 1,
    content: "Great, thanks Bob! I've sent the SGS report to Sanjay. He was pleased and is now seeking discount approval from their CFO. Submitted the final quotation.",
    createdAt: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: "com-1-2"
  },
  {
    id: "com-1-4",
    enquiryId: "enq-1",
    agentId: 3,
    content: "Excellent follow-up Alice. Rajdhani is planning to expand to two more plansifters next quarter, so winning this will secure follow-up orders.",
    createdAt: new Date(Date.now() - 1.2 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: null
  },
  {
    id: "com-2-1",
    enquiryId: "enq-2",
    agentId: 2,
    content: "Spoke with Vikram. They want to check if the conveyor belts are heat-resistant as well, since they will be transporting roasted seeds occasionally.",
    createdAt: new Date(Date.now() - 4.5 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: null
  },
  {
    id: "com-2-2",
    enquiryId: "enq-2",
    agentId: 4,
    content: "We can supply our BR-HeatShield conveyor grade. It handles up to 120°C. I will draft a comparison specs table.",
    createdAt: new Date(Date.now() - 3.8 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: "com-2-1"
  },
  {
    id: "com-2-3",
    enquiryId: "enq-2",
    agentId: 2,
    content: "Perfect Diana. Share the spec comparison with me. I'll pitch it to Vikram tomorrow.",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: "com-2-2"
  },
  {
    id: "com-4-1",
    enquiryId: "enq-4",
    agentId: 4,
    content: "ITC procurement is bargaining on the sewing machines. They want a 5% discount on the D-9 units if we supply an extra set of sewing needles (100 units).",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: null
  },
  {
    id: "com-4-2",
    enquiryId: "enq-4",
    agentId: 1,
    content: "Diana, the sewing needles are inexpensive accessory items. We can easily bundle them as a value-add instead of giving a cash discount. Tell them we'll supply 150 needles free.",
    createdAt: new Date(Date.now() - 2.1 * 24 * 60 * 60 * 1000).toISOString(),
    parentId: "com-4-1"
  }
];

const LOCAL_STORAGE_KEY = "brindavan_enquiry_tracker_db";

export interface StoredData {
  enquiries: Enquiry[];
  comments: Comment[];
  agents: Agent[];
}

export function getStoredData(): StoredData {
  if (typeof window === "undefined") {
    return {
      enquiries: INITIAL_ENQUIRIES,
      comments: INITIAL_COMMENTS,
      agents: INITIAL_AGENTS
    };
  }

  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.enquiries && parsed.comments && parsed.agents) {
        return parsed;
      }
    }
  } catch (error) {
    console.error("Failed to load data from localStorage", error);
  }

  // Fallback to initial values and save them
  const initialData = {
    enquiries: INITIAL_ENQUIRIES,
    comments: INITIAL_COMMENTS,
    agents: INITIAL_AGENTS
  };
  saveToStorage(initialData.enquiries, initialData.comments, initialData.agents);
  return initialData;
}

export function saveToStorage(enquiries: Enquiry[], comments: Comment[], agents: Agent[]): void {
  if (typeof window === "undefined") return;
  
  try {
    const dataString = JSON.stringify({ enquiries, comments, agents });
    localStorage.setItem(LOCAL_STORAGE_KEY, dataString);
  } catch (error) {
    console.error("Failed to save data to localStorage", error);
  }
}
