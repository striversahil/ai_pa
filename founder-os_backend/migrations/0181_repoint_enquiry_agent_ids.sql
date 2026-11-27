-- 0181 — re-point Enquiry.assignedAgentId (and fieldStaffId) at employee ids.
--
-- 0177 re-pointed every sales-derived id in history EXCEPT Enquiry: 757 rows
-- still store the ids of the retired roster rows (32-hex and uuid), which
-- exist in no table, so the sales list rendered the lead chip as
-- "Unassigned" for every enquiry (reported 2026-11-27).
--
-- The mapping is recoverable because Estimate.createdBy WAS re-pointed: for
-- each dead enquiry id, the estimates those enquiries produced now name the
-- employee. Majority wins because a few estimates are reassigned after the
-- fact (one dead id spreads over two employees, e.g. 6f4ecff6 = 124 Raja +
-- 1 Anand). Only live employees are allowed as targets — a dead id that
-- re-points to another dead id (a person who left) is left untouched, so an
-- unattributable press stays unattributable instead of being guessed.
--
-- Not touched: the core shadow (`core_lead.assignedAgentId`) is core-locked;
-- its mirror is INSERT OR IGNORE and heals on the next enquiry write.
CREATE TABLE IF NOT EXISTS _enq_agent_map (stale TEXT PRIMARY KEY, target TEXT NOT NULL);

INSERT OR REPLACE INTO _enq_agent_map (stale, target)
SELECT stale, target FROM (
  SELECT stale, target, ROW_NUMBER() OVER (PARTITION BY stale ORDER BY n DESC, target) AS rn
  FROM (
    SELECT e.assignedAgentId AS stale, es.createdBy AS target, COUNT(*) AS n
    FROM Enquiry e
    JOIN Estimate es ON es.estimateNumber = e.estNumber
    WHERE length(e.assignedAgentId) > 0
      AND NOT EXISTS (SELECT 1 FROM Telecaller t WHERE t.id = e.assignedAgentId)
      AND EXISTS (SELECT 1 FROM HumanResourcesMember h WHERE h.id = es.createdBy AND coalesce(h.deleted, 0) = 0)
    GROUP BY e.assignedAgentId, es.createdBy
  )
)
WHERE rn = 1;

UPDATE Enquiry
SET assignedAgentId = (SELECT m.target FROM _enq_agent_map m WHERE m.stale = Enquiry.assignedAgentId)
WHERE EXISTS (SELECT 1 FROM _enq_agent_map m WHERE m.stale = Enquiry.assignedAgentId);

UPDATE Enquiry
SET fieldStaffId = (SELECT m.target FROM _enq_agent_map m WHERE m.stale = Enquiry.fieldStaffId)
WHERE EXISTS (SELECT 1 FROM _enq_agent_map m WHERE m.stale = Enquiry.fieldStaffId);

DROP TABLE _enq_agent_map;
