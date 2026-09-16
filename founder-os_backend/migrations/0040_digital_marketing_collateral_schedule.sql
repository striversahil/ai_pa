-- Digital Marketing: collateral posting → twice-weekly schedule (1 post each day).
-- FB: Mon+Wed, IG: Tue+Thu, GBP: Wed+Fri, LI: Thu+Sat. Idempotent — safe to re-run.
UPDATE "DigitalMarketingTaskTemplate" SET
  "title" = 'Company Pages – Collateral Posting Facebook: Publish Post',
  "ruleType" = 'multi_occurrence',
  "ruleJson" = '{"type":"multi_occurrence","occurrences":[{"type":"weekday","weekday":"Monday","occurrence":"every"},{"type":"weekday","weekday":"Wednesday","occurrence":"every"}]}',
  "rawText" = 'Monday, Wednesday',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-02';

UPDATE "DigitalMarketingTaskTemplate" SET
  "title" = 'Company Pages – Collateral Posting Instagram: Publish Post',
  "ruleType" = 'multi_occurrence',
  "ruleJson" = '{"type":"multi_occurrence","occurrences":[{"type":"weekday","weekday":"Tuesday","occurrence":"every"},{"type":"weekday","weekday":"Thursday","occurrence":"every"}]}',
  "rawText" = 'Tuesday, Thursday',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-03';

UPDATE "DigitalMarketingTaskTemplate" SET
  "title" = 'Company Pages – Collateral Posting Google Business Profile: Publish Post',
  "ruleType" = 'multi_occurrence',
  "ruleJson" = '{"type":"multi_occurrence","occurrences":[{"type":"weekday","weekday":"Wednesday","occurrence":"every"},{"type":"weekday","weekday":"Friday","occurrence":"every"}]}',
  "rawText" = 'Wednesday, Friday',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-04';

UPDATE "DigitalMarketingTaskTemplate" SET
  "title" = 'Company Pages – Collateral Posting LinkedIn: Publish Post',
  "ruleType" = 'multi_occurrence',
  "ruleJson" = '{"type":"multi_occurrence","occurrences":[{"type":"weekday","weekday":"Thursday","occurrence":"every"},{"type":"weekday","weekday":"Saturday","occurrence":"every"}]}',
  "rawText" = 'Thursday, Saturday',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-05';
