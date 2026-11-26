-- 0176 — merge the duplicate HR record for the sales TL (2026-11-27).
--
-- The same person existed twice in the HR register (both active, both
-- 'Team Lead', both on login sales.teamlead1.01@gmail.com): the complete
-- payroll row BUI-019 carried the legal name 'Rajiv Kapoor' while BUI-024
-- carried the real legal name 'Anand Sharma' plus characterName 'Rajiv
-- Kapoor'. Keep the complete row (PAN/Aadhaar/bank/salary components) and
-- make it the one employee: legal name Anand Sharma, character Rajiv Kapoor.
--
-- His roster history was split too: the live row is 'tl-rajiv-kapoor'
-- (R1+R3, 16 estimates) while the retired seeded row 9ac49148… still owned 3
-- estimates and a 50-point close credit — a deleted creator is unknown to the
-- leaderboard, so that history vanished. Re-point it at the live row.
--
-- Idempotent-ish: every statement is scoped by the production row ids and
-- is a no-op on a database that never had them.

UPDATE HumanResourcesMember
   SET name = 'Anand Sharma',
       characterName = 'Rajiv Kapoor',
       useCharacterName = 1,
       active = 1,
       deleted = 0,
       loginEmail = 'sales.teamlead1.01@gmail.com'
 WHERE id = '3fcfa119-76c8-4140-bf4e-7f2d09125cae';

-- The duplicate row's draft Nov-2026 slip is a zero-value copy of the
-- survivor's draft — drop it before hiding the row.
DELETE FROM HumanResourcesSalaryComponent
 WHERE memberId = '365ab3a1-24a3-4c00-9abe-8e926a28ceba';
DELETE FROM HumanResourcesSalarySlip
 WHERE memberId = '365ab3a1-24a3-4c00-9abe-8e926a28ceba';

UPDATE HumanResourcesMember
   SET active = 0, deleted = 1
 WHERE id IN ('365ab3a1-24a3-4c00-9abe-8e926a28ceba',
              'cea0b480-95ab-4f30-b0fc-47b084c7951f',
              '1d9e3cd8-c5e4-495a-af8c-4ae734b9fc34');

-- Backfill the team-lead leaderboard history onto the live roster row.
UPDATE Estimate
   SET createdBy = 'tl-rajiv-kapoor'
 WHERE createdBy IN ('9ac49148-f713-411c-9062-c6f007a7eed3',
                    'bd8c8a1c-0a9c-49dc-94ff-8c0dcf0ae411');

UPDATE TelecallerScoreEvent
   SET telecallerId = 'tl-rajiv-kapoor'
 WHERE telecallerId IN ('9ac49148-f713-411c-9062-c6f007a7eed3',
                       'bd8c8a1c-0a9c-49dc-94ff-8c0dcf0ae411');

UPDATE core_credit
   SET telecallerId = 'tl-rajiv-kapoor'
 WHERE telecallerId IN ('9ac49148-f713-411c-9062-c6f007a7eed3',
                       'bd8c8a1c-0a9c-49dc-94ff-8c0dcf0ae411');