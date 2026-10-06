-- Bulk price-list import: staging batches + rows, batch linkage on rates.
CREATE TABLE IF NOT EXISTS BulkBatch (
  id TEXT PRIMARY KEY,
  vendorId TEXT,
  sourceKind TEXT DEFAULT 'paste',
  sourceName TEXT DEFAULT '',
  sourceFileKey TEXT,
  sourceText TEXT,
  quotedAt TEXT,
  status TEXT DEFAULT 'review',
  disabled INTEGER DEFAULT 0,
  rowCount INTEGER DEFAULT 0,
  readyCount INTEGER DEFAULT 0,
  createdBy TEXT DEFAULT '',
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_bulkbatch_status_created ON BulkBatch(status, createdAt);

CREATE TABLE IF NOT EXISTS BulkRow (
  id TEXT PRIMARY KEY,
  batchId TEXT NOT NULL REFERENCES BulkBatch(id) ON DELETE CASCADE,
  rowNo INTEGER DEFAULT 0,
  rawText TEXT DEFAULT '',
  rawHash TEXT DEFAULT '',
  productId TEXT,
  productName TEXT,
  isNewProduct INTEGER DEFAULT 0,
  newCategory TEXT,
  vendorId TEXT,
  vendorName TEXT,
  price REAL,
  unit TEXT,
  discount REAL,
  moq TEXT,
  deliveryDays INTEGER,
  weightPerUnit REAL,
  packageQty TEXT,
  packageDims TEXT,
  quotedAt TEXT,
  specs TEXT,
  missing TEXT,
  matchConfidence REAL,
  duplicateOf TEXT,
  status TEXT DEFAULT 'needs-product',
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_bulkrow_batch_status ON BulkRow(batchId, status);
CREATE INDEX IF NOT EXISTS idx_bulkrow_hash ON BulkRow(rawHash);

ALTER TABLE VendorRate ADD COLUMN batchId TEXT;
ALTER TABLE VendorRate ADD COLUMN sourceRef TEXT;
CREATE INDEX IF NOT EXISTS idx_vendorrate_batch ON VendorRate(batchId);
