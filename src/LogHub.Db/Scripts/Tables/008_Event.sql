-- Log events, partitioned by day on timestamp.
-- No audit columns: rows are machine data written by the ingestion pipeline.
-- No foreign key on api_key_id: deleting a key must not touch stored events.
create extension if not exists pg_trgm;

create table event (
    id               bigint generated always as identity,
    timestamp        timestamptz not null,
    arrived          timestamptz not null default now(),
    level            varchar(50),
    level_rank       smallint    not null default 2, -- 0 Verbose, 1 Debug, 2 Information, 3 Warning, 4 Error, 5 Fatal
    message_template text,
    message          text,
    exception        text,
    event_type       bigint,
    trace_id         varchar(32),
    span_id          varchar(16),
    parent_span_id   varchar(16),
    span_kind        varchar(20),
    span_start       timestamptz,
    properties       jsonb       not null default '{}',
    renderings       jsonb,
    resource         jsonb,
    scope            jsonb,
    api_key_id       bigint,
    primary key (id, timestamp)
) partition by range (timestamp);

-- Catch-all partition. Daily partitions are created by the server at runtime.
create table event_default partition of event default;

create index ix_event_timestamp_id on event (timestamp desc, id desc);
create index ix_event_level_rank on event (level_rank);
create index ix_event_event_type on event (event_type);
create index ix_event_trace_id on event (trace_id) where trace_id is not null;
create index ix_event_properties on event using gin (properties jsonb_path_ops);
create index ix_event_message_trgm on event using gin (message gin_trgm_ops);
