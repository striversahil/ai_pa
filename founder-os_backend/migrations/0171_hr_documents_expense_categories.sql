-- 0171_hr_documents_expense_categories.sql — HR-managed document types and
-- expense categories.
--
-- Document types are HR's own checklist: HR decides what every employee must
-- provide, and uploads the individual files. Expense categories replace the
-- old free-text field with the same controller-owned list. Both are additive:
-- existing expense rows keep their category text and are backfilled by name.

CREATE TABLE IF NOT EXISTS "HumanResourcesDocumentType" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "nameKey"     TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "required"    INTEGER NOT NULL DEFAULT 0,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "active"      INTEGER NOT NULL DEFAULT 1,
  "createdBy"   TEXT,
  "updatedBy"   TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_hr_document_type_active_order"
  ON "HumanResourcesDocumentType" ("active", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesMemberDocument" (
  "id"             TEXT PRIMARY KEY,
  "memberId"       TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "documentTypeId" TEXT NOT NULL REFERENCES "HumanResourcesDocumentType"("id") ON DELETE RESTRICT,
  "title"          TEXT NOT NULL DEFAULT '',
  "fileName"       TEXT NOT NULL,
  "mime"           TEXT NOT NULL DEFAULT 'application/pdf',
  "size"           INTEGER NOT NULL DEFAULT 0,
  "kvKey"          TEXT NOT NULL UNIQUE,
  "uploadedBy"     TEXT NOT NULL DEFAULT '',
  "deleted"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_hr_member_document_member"
  ON "HumanResourcesMemberDocument" ("memberId", "deleted");
CREATE INDEX IF NOT EXISTS "idx_hr_member_document_type"
  ON "HumanResourcesMemberDocument" ("documentTypeId");

CREATE TABLE IF NOT EXISTS "HumanResourcesExpenseCategory" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "nameKey"   TEXT NOT NULL UNIQUE,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "active"    INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_hr_expense_category_active_order"
  ON "HumanResourcesExpenseCategory" ("active", "order");

ALTER TABLE "HumanResourcesExpense" ADD COLUMN "categoryId" TEXT;
CREATE INDEX IF NOT EXISTS "idx_hr_expense_category_id"
  ON "HumanResourcesExpense" ("categoryId");

INSERT OR IGNORE INTO "HumanResourcesDocumentType"
  ("id", "name", "nameKey", "description", "required", "order", "active")
VALUES
  ('hrdoctype-aadhaar',    'Aadhaar Card',           'aadhaar card',           'Government photo identity', 1, 0, 1),
  ('hrdoctype-pan',        'PAN Card',               'pan card',               'Tax identity card', 1, 1, 1),
  ('hrdoctype-bank',       'Bank Details',           'bank details',           'Cancelled cheque or bank proof', 0, 2, 1),
  ('hrdoctype-offer',      'Offer Letter',           'offer letter',           'Signed offer letter', 0, 3, 1),
  ('hrdoctype-resume',     'Resume',                 'resume',                 'Latest CV', 0, 4, 1),
  ('hrdoctype-photo',      'Passport Photo',         'passport photo',         'Recent passport-size photo', 0, 5, 1),
  ('hrdoctype-police',     'Police Verification',    'police verification',    'Police verification certificate', 0, 6, 1),
  ('hrdoctype-education',  'Education Certificates', 'education certificates', 'Degrees and marksheets', 0, 7, 1),
  ('hrdoctype-experience', 'Experience Letters',     'experience letters',     'Relieving and experience letters', 0, 8, 1),
  ('hrdoctype-other',      'Other',                  'other',                  'Any other employee document', 0, 9, 1);

INSERT OR IGNORE INTO "HumanResourcesExpenseCategory"
  ("id", "name", "nameKey", "order", "active")
VALUES
  ('hrexpcat-rent',          'Rent',           'rent',           0, 1),
  ('hrexpcat-utilities',     'Utilities',      'utilities',      1, 1),
  ('hrexpcat-office-supplies','Office supplies','office supplies',2, 1),
  ('hrexpcat-travel',        'Travel',         'travel',         3, 1),
  ('hrexpcat-food',          'Food',           'food',           4, 1),
  ('hrexpcat-pantry',        'Pantry',         'pantry',         5, 1),
  ('hrexpcat-printing',      'Printing',       'printing',       6, 1),
  ('hrexpcat-housekeeping',  'Housekeeping',   'housekeeping',   7, 1),
  ('hrexpcat-festival',      'Festival',       'festival',       8, 1),
  ('hrexpcat-other',         'Other',          'other',          9, 1);

INSERT OR IGNORE INTO "HumanResourcesExpenseCategory"
  ("id", "name", "nameKey", "order", "active")
SELECT
  'hrexpcat-' || lower(hex(randomblob(8))),
  min(trim("category")),
  lower(trim("category")),
  100,
  1
FROM "HumanResourcesExpense"
WHERE "category" IS NOT NULL
  AND trim("category") <> ''
  AND "deleted" = 0
GROUP BY lower(trim("category"));

UPDATE "HumanResourcesExpense"
SET "categoryId" = (
  SELECT "id" FROM "HumanResourcesExpenseCategory"
  WHERE "nameKey" = lower(trim("HumanResourcesExpense"."category"))
  LIMIT 1
)
WHERE "categoryId" IS NULL
  AND "category" IS NOT NULL
  AND trim("category") <> '';
