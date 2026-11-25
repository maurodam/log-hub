create table retention_schedule (
    id smallint primary key check (id = 1),
    requested_version bigint not null default 0,
    completed_version bigint not null default 0,
    completed_at timestamptz
);

insert into retention_schedule (id) values (1);
