-- 0070_sales_roster_field_staff.sql
-- Sales roster gains a staff TYPE: dashboard telecallers vs field staff.
-- Field staff never operate the dashboard; a sales agent logs their enquiry
-- with source 'Field Staff' and picks them from the roster. The enquiry (and
-- its 20% generator credit / estimate region) belongs to the field staff;
-- loggedByAgentId records the sales agent who entered it.
ALTER TABLE Telecaller ADD COLUMN type TEXT NOT NULL DEFAULT 'telecaller';

ALTER TABLE Enquiry ADD COLUMN fieldStaffId TEXT NOT NULL DEFAULT '';
ALTER TABLE Enquiry ADD COLUMN loggedByAgentId TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_enquiry_field_staff ON Enquiry(fieldStaffId);
