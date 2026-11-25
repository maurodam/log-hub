create table saved_dashboard (
    id bigint generated always as identity primary key,
    name varchar(100) not null,
    widgets jsonb not null default '[]',
    revision integer not null default 1
);
