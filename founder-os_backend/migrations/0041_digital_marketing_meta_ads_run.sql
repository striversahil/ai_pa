-- Digital Marketing: Meta Ads Run (dmm-06) → Saturday-start campaign schema
-- (category dropdown + amount spent + from/to run window; daily box stays open
-- during the run for inquiries/leads) + Whatsapp Marketing (dmm-08) amount spent.
-- Idempotent — safe to re-run.
UPDATE "DigitalMarketingTaskTemplate" SET
  "title" = 'Meta Ads Run',
  "description" = 'Saturday starts the campaign (category + amount + from/to); daily box stays open during the run to capture inquiries/leads.',
  "metricsSchema" = '[{"key":"category","label":"Category","type":"select","options":["Wire Mesh","Transmission Accessories","Roller Mill Accessories","Purifier Accessories","Plansifter Accessories","Perforated Sheets","Miscellaneous","Magnets","Lab Equipments","Conveying Accessories","Pipe Accessories"] },{"key":"amountSpent","label":"Amount Spent (₹)","type":"number"},{"key":"fromDate","label":"Ad Run From","type":"date"},{"key":"toDate","label":"Ad Run To","type":"date"},{"key":"inquiries","label":"No of Inquiries Generated","type":"number"},{"key":"leads","label":"Leads Generated","type":"number"}]',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-06';

UPDATE "DigitalMarketingTaskTemplate" SET
  "metricsSchema" = '[{"key":"dataSource","label":"Data used for marketing (source / list)","type":"text"},{"key":"amountSpent","label":"Amount Spent (₹)","type":"number"},{"key":"whatsappCount","label":"Whatsapp Marketing Count","type":"number"},{"key":"whatsappLeads","label":"Leads Generated Count","type":"number"}]',
  "updatedAt" = datetime('now')
WHERE "id" = 'dmm-08';
