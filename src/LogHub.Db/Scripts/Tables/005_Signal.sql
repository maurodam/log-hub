-- Saved filters. owner_id null means shared with everyone.
-- Filter: { "text", "levels", "properties", "apiKeyIds", "hasException", "traceId" } (see docs/api/v1.md, FilterSpec).
-- Selected signals with the same group_name combine with OR; different groups combine with AND.
create table signal (
    id                bigint generated always as identity primary key,
    title             varchar(200) not null,
    description       varchar(1000),
    filter            jsonb        not null default '{}',
    group_name        varchar(100),
    is_protected      boolean      not null default false,
    owner_id          bigint       references users (id) on delete cascade,
    user_created_id   bigint       references users (id),
    user_created_date timestamptz  not null default now(),
    user_updated_id   bigint       references users (id),
    user_updated_date timestamptz
);

create index ix_signal_owner_id on signal (owner_id);
