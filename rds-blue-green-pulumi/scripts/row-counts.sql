-- Exact row count for every table, one "schema.table|count" line each. Run it
-- read-only against blue and green from the same host, then diff the two files:
--
--   export PGOPTIONS='-c default_transaction_read_only=on'
--   psql -At "$BLUE_URL" -f scripts/row-counts.sql > blue.txt
--   psql -At "$GREEN_URL" -f scripts/row-counts.sql > green.txt
--   diff blue.txt green.txt
--
-- Blue keeps taking writes, so check that OldestReplicationSlotLag is near zero
-- first and expect busy tables to differ by in-flight rows.

SELECT format('SELECT %L, count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND c.relpersistence = 'p'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY n.nspname, c.relname
\gexec
