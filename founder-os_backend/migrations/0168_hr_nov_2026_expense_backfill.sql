-- 0168_hr_nov_2026_expense_backfill.sql — backfill the Nov 2026 office
-- ledger into the HR expense + fund ledgers (2026-11-26).
--
-- Source: the founder's November 2026 office-cash ledger — 30 expense lines
-- (serials 1-12, 14-31; serial 13 is absent in the source) and one additional
-- fund of Rs 1,000 from Dwarka Sir on 19-11-2026.
--
-- The Rs 15,000 capital infusion (ledger 29-10-2026) is ALREADY recorded as
-- HumanResourcesFundTxn 'Brindavan Udyog India' (2026-10-28, Rs 15,000), so it
-- is deliberately NOT inserted again. A companion Rs 4,400 'Opening balance'
-- top-up already neutralises the pre-ledger October spend, which is why the
-- live office balance is Rs 15,000 = the ledger's opening balance.
--
-- Classification rule (app definition: fixed costs recur, variable costs change
-- month to month):
--   fixed    = committed recurring office-running cost — daily milk, monthly tea
--              advance, building/water/washroom cleaning;
--   variable = event/usage-driven spend — festival, travel, printing, food,
--              supplies, one-offs.
--
-- Dates are preserved exactly, so the two 30-10-2026 lines land in the October
-- month view. Lifetime office balance after this backfill + the extra Rs 1,000:
--   15,000 + 1,000 - 14,739 = Rs 1,261 (matches the ledger's final balance).
-- Re-running is safe: deterministic ids + INSERT OR IGNORE.

INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-01','Milk (Morning & Evening) 26-31th Oct (06 days)','fixed','Pantry',744,'2026-10-30','2026-10','cash','Nov 2026 ledger #1 · closing Rs 14,256','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-02','Nov, 26 Tea advance','fixed','Pantry',756,'2026-10-30','2026-10','cash','Nov 2026 ledger #2 · closing Rs 13,500','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-03','Chabri Bazar Diwali material for Simi mam (Auto 350, Metro-31, Rahul-50)','variable','Festival',381,'2026-11-02','2026-11','cash','Nov 2026 ledger #3 · closing Rs 13,119','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-04','Metro travel payment for chabri bazar again to Vikram','variable','Travel',64,'2026-11-03','2026-11','cash','Nov 2026 ledger #4 · closing Rs 13,055','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-05','Tea evening (11person)','variable','Pantry',165,'2026-11-03','2026-11','cash','Nov 2026 ledger #5 · closing Rs 12,890','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-06','Diwali Decordation (Rs 180/-) Subhdipawli, Centre&latkan) and ganeshji & Parwatiji (120/-)','variable','Festival',300,'2026-11-04','2026-11','cash','Nov 2026 ledger #6 · closing Rs 12,590','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-07','Roll for sir and tea for me','variable','Food',110,'2026-11-04','2026-11','cash','Nov 2026 ledger #7 · closing Rs 12,480','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-08','Chabri bazar Vikram metro both side','variable','Travel',64,'2026-11-05','2026-11','cash','Nov 2026 ledger #8 · closing Rs 12,416','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-09','Tea evening (Vikram in chabri Bazar)','variable','Pantry',190,'2026-11-05','2026-11','cash','Nov 2026 ledger #9 · closing Rs 12,226','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-10','Naval Stationary (files & other)','variable','Office supplies',50,'2026-11-06','2026-11','cash','Nov 2026 ledger #10 · closing Rs 12,176','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-11','Demo of New Broucher','variable','Printing',60,'2026-11-06','2026-11','cash','Nov 2026 ledger #11 · closing Rs 12,116','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-12','Vikram Chabri Bazar','variable','Travel',70,'2026-11-06','2026-11','cash','Nov 2026 ledger #12 · closing Rs 12,046','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-14','Diwali pay to washroom cleaner','variable','Housekeeping',200,'2026-11-07','2026-11','cash','Nov 2026 ledger #14 · closing Rs 11,846','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-15','Cocacola / Drinks','variable','Festival',400,'2026-11-07','2026-11','cash','Nov 2026 ledger #15 · closing Rs 11,446','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-16','Lunch for Diwali party','variable','Festival',3610,'2026-11-07','2026-11','cash','Nov 2026 ledger #16 · closing Rs 7,836','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-17','Safai wale building','fixed','Housekeeping',200,'2026-11-07','2026-11','cash','Nov 2026 ledger #17 · closing Rs 7,636','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-18','Pani wala','fixed','Housekeeping',100,'2026-11-09','2026-11','cash','Nov 2026 ledger #18 · closing Rs 7,536','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-19','Washroom cleaner','fixed','Housekeeping',200,'2026-11-09','2026-11','cash','Nov 2026 ledger #19 · closing Rs 7,336','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-20','Sir food in my absence','variable','Food',200,'2026-11-11','2026-11','cash','Nov 2026 ledger #20 · closing Rs 7,136','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-21','Vikram Nehru Place (Print)','variable','Printing',100,'2026-11-12','2026-11','cash','Nov 2026 ledger #21 · closing Rs 7,036','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-22','Tea evening','variable','Pantry',195,'2026-11-12','2026-11','cash','Nov 2026 ledger #22 · closing Rs 6,841','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-23','Omkar','variable','Other',2000,'2026-11-12','2026-11','cash','Nov 2026 ledger #23 · closing Rs 4,841 · no description in source','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-24','Vikram Nehru Place (Print book)','variable','Printing',100,'2026-11-14','2026-11','cash','Nov 2026 ledger #24 · closing Rs 4,741','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-25','Megha Book Print (Demo)','variable','Printing',350,'2026-11-14','2026-11','cash','Nov 2026 ledger #25 · closing Rs 4,391','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-26','Tea evening','variable','Pantry',105,'2026-11-14','2026-11','cash','Nov 2026 ledger #26 · closing Rs 4,286','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-27','3rd party Diwali','variable','Festival',500,'2026-11-16','2026-11','cash','Nov 2026 ledger #27 · closing Rs 3,786','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-28','Samarth Sir personal work (MU)','variable','Personal / reimbursement',2645,'2026-11-17','2026-11','cash','Nov 2026 ledger #28 · closing Rs 1,141','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-29','Samosa time','variable','Food',30,'2026-11-17','2026-11','cash','Nov 2026 ledger #29 · closing Rs 1,111','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-30','Ink in printer (Acct. & HR)','variable','Office supplies',500,'2026-11-18','2026-11','cash','Nov 2026 ledger #30 · closing Rs 611','Sahil Kumar','Sahil Kumar');
INSERT OR IGNORE INTO "HumanResourcesExpense"
  ("id","title","expenseType","category","amount","expenseDate","expenseMonth","paymentMode","notes","createdBy","updatedBy")
VALUES ('hr-nov26-exp-31','Visiting Card of Harish Kr','variable','Printing',350,'2026-11-19','2026-11','cash','Nov 2026 ledger #31 · closing Rs 261','Sahil Kumar','Sahil Kumar');

-- Additional fund: Dwarka Sir's Rs 1,000 on 19-11-2026 (ledger serial 32).
INSERT OR IGNORE INTO "HumanResourcesFundTxn"
  ("id","title","amount","txnDate","notes","createdBy","updatedBy")
VALUES ('hr-nov26-fund-32','Dwarka Sir give 1000/- (Diwali)',1000,'2026-11-19',
  'Nov 2026 ledger #32 · updated balance Rs 1,261','Sahil Kumar','Sahil Kumar');
