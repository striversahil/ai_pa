-- Enquiry tracker (live sales pipeline) — enquiries + threaded comments.
CREATE TABLE IF NOT EXISTS Enquiry (
  id TEXT PRIMARY KEY,
  clientCompany TEXT NOT NULL,
  contactName TEXT NOT NULL,
  contactEmail TEXT NOT NULL,
  contactPhone TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'new',
  assignedAgentId INTEGER NOT NULL DEFAULT 0,
  estimatedValue REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  imageUrls TEXT,
  activities TEXT
);
CREATE INDEX IF NOT EXISTS idx_enquiry_status ON Enquiry(status);
CREATE INDEX IF NOT EXISTS idx_enquiry_created ON Enquiry(createdAt);
CREATE TABLE IF NOT EXISTS EnquiryComment (
  id TEXT PRIMARY KEY,
  enquiryId TEXT NOT NULL,
  agentId INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  parentId TEXT,
  imageUrl TEXT,
  FOREIGN KEY (enquiryId) REFERENCES Enquiry(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_enquiry_comment ON EnquiryComment(enquiryId, createdAt);