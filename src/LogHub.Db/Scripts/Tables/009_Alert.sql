-- Email alerts: count events matching signal_id and filter in the last window_minutes;
-- notify recipients when the count reaches threshold, at most once per suppression_minutes.
create table alert (
    id                  bigint generated always as identity primary key,
    title               varchar(200)  not null,
    description         varchar(1000),
    signal_id           bigint        references signal (id) on delete set null,
    filter              jsonb         not null default '{}',
    threshold           integer       not null default 1 check (threshold > 0),
    window_minutes      integer       not null default 5 check (window_minutes > 0),
    suppression_minutes integer       not null default 60 check (suppression_minutes >= 0),
    recipients          text[]        not null default '{}',
    is_enabled          boolean       not null default true,
    last_checked_date   timestamptz,
    last_triggered_date timestamptz,
    last_error          varchar(2000),
    user_created_id     bigint        references users (id),
    user_created_date   timestamptz   not null default now(),
    user_updated_id     bigint        references users (id),
    user_updated_date   timestamptz
);
