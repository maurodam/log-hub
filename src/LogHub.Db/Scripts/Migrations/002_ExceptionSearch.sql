-- For a populated installation, build matching indexes CONCURRENTLY on the
-- leaf partitions before running this migration.
create index ix_event_exception_trgm on event using gin (exception gin_trgm_ops);
