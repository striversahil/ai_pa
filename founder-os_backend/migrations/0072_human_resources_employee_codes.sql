WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "HumanResourcesMember"
  WHERE "employeeCode" IS NULL
)
UPDATE "HumanResourcesMember"
SET "employeeCode" = 'BUI-' || printf('%03d',
  (SELECT COALESCE(MAX(CAST(SUBSTR("employeeCode", 5) AS INTEGER)), 0)
   FROM "HumanResourcesMember"
   WHERE "employeeCode" GLOB 'BUI-[0-9]*')
  + (SELECT rn FROM numbered WHERE numbered."id" = "HumanResourcesMember"."id"))
WHERE "id" IN (SELECT "id" FROM numbered);
