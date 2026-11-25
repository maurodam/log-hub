create table webhook_destination (
    id bigint generated always as identity primary key,
    name varchar(100) not null,
    kind varchar(10) not null check (kind in ('teams', 'slack', 'generic')),
    protected_url text not null,
    protected_secret text,
    enabled boolean not null default true,
    deleted boolean not null default false
);

alter table alert add column webhook_destination_ids bigint[] not null default '{}';

create table webhook_delivery (
    id bigint generated always as identity primary key,
    alert_id bigint not null references alert (id) on delete cascade,
    destination_id bigint not null references webhook_destination (id),
    destination_name varchar(100) not null,
    kind varchar(10) not null,
    alert_title varchar(200) not null,
    window_start timestamptz not null,
    created_at timestamptz not null default now(),
    event_count bigint not null,
    is_test boolean not null,
    status varchar(20) not null default 'Pending',
    attempts integer not null default 0,
    next_attempt timestamptz not null default now(),
    lease_id uuid,
    error text
);

create index ix_webhook_delivery_pair on webhook_delivery (alert_id, destination_id, created_at desc);
create index ix_webhook_delivery_due on webhook_delivery (next_attempt, id) where status = 'Pending';
create unique index ix_webhook_delivery_active on webhook_delivery (alert_id, destination_id)
    where status = 'Pending' and not is_test;
