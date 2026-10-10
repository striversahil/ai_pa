-- 0058: enquiry searchText column (search without blob sweeps).
-- The list/search path used to LIKE-sweep the `items` JSON (megabytes of
-- embedded base64 per row) + `description` on every keystroke burst — the
-- same columns Zoho refuses in COQL criteria. `searchText` is a tight,
-- write-maintained, lowercased identity string: scalars + description prefix
-- + item names/specs/qtys + vendor names. Deliberately EXCLUDED: media
-- data-URIs, thread text, rates amounts, comments (blobs/PII/workflow).
-- No b-tree index: leading-wildcard LIKE can't ride one (documented, not an
-- oversight); the win is scanning KBs per row instead of MBs.
ALTER TABLE Enquiry ADD COLUMN searchText TEXT DEFAULT '';
UPDATE Enquiry SET searchText = lower(substr(
  coalesce(estNumber,'') || ' | ' || coalesce(enquiryNumber,'') || ' | ' ||
  coalesce(title,'') || ' | ' || coalesce(clientCompany,'') || ' | ' ||
  coalesce(contactName,'') || ' | ' || coalesce(contactPhone,'') || ' | ' ||
  coalesce(sourceLead,'') || ' | ' || coalesce(location,'') || ' | ' ||
  coalesce(substr(description,1,300),'') ||
  coalesce((SELECT ' | ' || group_concat(
    coalesce(json_extract(value,'$.name'),'') || ' ' ||
    coalesce(json_extract(value,'$.qty'),'') || ' ' ||
    coalesce(json_extract(value,'$.spec'),'') || ' ' ||
    coalesce(json_extract(value,'$.category'),'') || ' ' ||
    coalesce(json_extract(value,'$.kypItem'),''), ' | ')
    FROM json_each(items) WHERE json_valid(items)), '') ||
  coalesce((SELECT ' | ' || group_concat(json_extract(r.value,'$.vendor'), ' | ')
    FROM json_each(items) i, json_each(json_extract(i.value,'$.rates')) r
    WHERE json_valid(items)), ''),
1, 2000)) WHERE searchText IS NULL OR searchText = '';
