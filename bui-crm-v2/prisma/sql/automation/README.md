# Automation SQL (AI-editable)

Put SQL for automation-schema objects here: read-only views over core, indexes on
automation tables, materialised report caches. `SELECT` from `core.*` is fine; any
statement that writes to or alters `core` or `public` fails `schema-guard`.
New tables created in the `automation` schema are audited automatically by the
core event trigger.
