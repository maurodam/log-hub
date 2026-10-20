-- Retention policies. signal_id null applies the policy to all events (at most one such policy).
create table retention (
    id                 bigint generated always as identity primary key,
    signal_id          bigint      references signal (id) on delete cascade,
    retention_days     integer     not null check (retention_days > 0),
    is_enabled         boolean     not null default true,
    last_run_date      timestamptz,
    last_deleted_count bigint,
    user_created_id    bigint      references users (id),
    user_created_date  timestamptz not null default now(),
    user_updated_id    bigint      references users (id),
    user_updated_date  timestamptz
);

create unique index ux_retention_signal_id on retention (signal_id) nulls not distinct;
