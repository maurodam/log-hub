-- History of alert emails.
create table notification (
    id                bigint generated always as identity primary key,
    alert_id          bigint       not null references alert (id) on delete cascade,
    triggered_date    timestamptz  not null default now(),
    event_count       bigint       not null,
    recipients        text[]       not null default '{}',
    status            varchar(20)  not null, -- Sent, Failed
    error             varchar(2000),
    user_created_id   bigint       references users (id),
    user_created_date timestamptz  not null default now(),
    user_updated_id   bigint       references users (id),
    user_updated_date timestamptz
);

create index ix_notification_alert_id_triggered_date on notification (alert_id, triggered_date desc);
