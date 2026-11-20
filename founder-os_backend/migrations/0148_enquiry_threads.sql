-- 0148_enquiry_threads.sql — per-item conversation threads between the three
-- enquiry desks (founder ask 2026-11-20).
--
-- channel = 'sales'    : sales <-> management (rate negotiation, client spec message)
-- channel = 'internal' : management <-> procurement. NEVER served to the sales
--                        desk — the route filters by channel server-side.
-- One row per thread; messages ride a JSON array (threads are short).
-- itemIndex + itemName snapshot locate the line item (items have no ids).
-- parentThreadId links an internal thread forwarded from a sales thread
-- (served to management only).

CREATE TABLE IF NOT EXISTS EnquiryThread (
  id             TEXT PRIMARY KEY,
  enquiryId      TEXT NOT NULL,
  itemIndex      INTEGER NOT NULL DEFAULT 0,
  itemName       TEXT NOT NULL DEFAULT '',
  channel        TEXT NOT NULL,                 -- 'sales' | 'internal'
  status         TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved'
  openedBy       TEXT NOT NULL,                 -- 'sales' | 'procurement' | 'management'
  waitingOn      TEXT NOT NULL,                 -- desk that owes the next reply
  parentThreadId TEXT,
  messages       TEXT NOT NULL DEFAULT '[]',
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  resolvedAt     TEXT,
  resolvedBy     TEXT
);

CREATE INDEX IF NOT EXISTS idx_enquiry_thread_enquiry ON EnquiryThread (enquiryId);
CREATE INDEX IF NOT EXISTS idx_enquiry_thread_inbox ON EnquiryThread (channel, status, updatedAt);
