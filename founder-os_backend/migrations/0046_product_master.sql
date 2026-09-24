-- Product master (KYP catalogue as data, not JSON) + vendor master + rates.
-- ProductItem: identity only. KypGuide: one row per checklist question (ultimate
-- guide table). Vendor + VendorRate: supplier master + priced quote facts.
CREATE TABLE IF NOT EXISTS ProductItem (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_productitem_category ON ProductItem(category, active);

CREATE TABLE IF NOT EXISTS KypGuide (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  attrKey TEXT NOT NULL,
  question TEXT NOT NULL,
  guideNote TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  isRequired INTEGER NOT NULL DEFAULT 1,
  condition TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (productId) REFERENCES ProductItem(id) ON DELETE CASCADE,
  UNIQUE (productId, attrKey)
);
CREATE INDEX IF NOT EXISTS idx_kypguide_product ON KypGuide(productId, sortOrder);

CREATE TABLE IF NOT EXISTS Vendor (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contactPerson TEXT,
  contactPhone1 TEXT,
  contactPhone2 TEXT,
  location TEXT,
  address TEXT,
  yearEstablished INTEGER,
  vendorType TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS VendorRate (
  id TEXT PRIMARY KEY,
  vendorId TEXT NOT NULL,
  productId TEXT,
  attrValues TEXT,
  attrKey TEXT NOT NULL DEFAULT '',
  pricePerUnit REAL,
  unit TEXT NOT NULL DEFAULT '',
  discountPercent REAL,
  baseRate REAL,
  weightPerUnit REAL,
  packageQty TEXT,
  packageDims TEXT,
  moq TEXT,
  deliveryDays INTEGER,
  quotedAt TEXT NOT NULL,
  enquiryRef TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (vendorId) REFERENCES Vendor(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES ProductItem(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vendorrate_product ON VendorRate(productId, attrKey);
CREATE INDEX IF NOT EXISTS idx_vendorrate_vendor ON VendorRate(vendorId);
