-- Read-only checks before an RDS for PostgreSQL Blue/Green deployment. Run against
-- every database on the instance:
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -f scripts/preflight.sql

\echo 'Replication settings: wal_level reads logical once rds.logical_replication is on and the instance has rebooted'
SELECT name, setting
FROM pg_settings
WHERE name IN ('rds.logical_replication', 'wal_level', 'max_replication_slots', 'max_wal_senders',
               'max_logical_replication_workers', 'max_worker_processes')
ORDER BY name;

\echo 'Databases: Blue/Green needs at least one logical replication worker per database'
SELECT datname
FROM pg_database
WHERE NOT datistemplate AND datname <> 'rdsadmin'
ORDER BY datname;

\echo 'Tables without a primary key: UPDATE and DELETE fail on them while the deployment exists, unless relreplident is f'
SELECT n.nspname, c.relname, c.relreplident,
       s.n_live_tup, s.n_tup_upd, s.n_tup_del, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')
ORDER BY n.nspname, c.relname;

\echo 'Large objects: not replicated to green'
SELECT count(*) AS large_objects FROM pg_largeobject_metadata;

\echo 'Unlogged tables: not replicated to green'
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relpersistence = 'u' AND c.relkind IN ('r', 'p')
ORDER BY n.nspname, c.relname;
