-- 0036: time taken per accounts task instance (hours+minutes entered on the
-- taskbar, stored as integer minutes; NULL = not recorded).
ALTER TABLE AccountsTaskLog ADD COLUMN timeSpentMin INTEGER;
