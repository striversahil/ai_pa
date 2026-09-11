-- Enquiry source + daily sequence number (label: Enquiry No {dailyNo} - {DD} {MON} {source}).
ALTER TABLE Enquiry ADD COLUMN source TEXT NOT NULL DEFAULT 'TL';
ALTER TABLE Enquiry ADD COLUMN dailyNo INTEGER;
-- Backfill: per-IST-day creation order for all existing rows.
UPDATE Enquiry AS e SET dailyNo = (
  SELECT rn FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY date(createdAt, '+5 hours', '+30 minutes')
      ORDER BY datetime(createdAt), id
    ) AS rn FROM Enquiry
  ) s WHERE s.id = e.id
);
