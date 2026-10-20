-- Instance settings as name/value pairs.
create table setting (
    id                bigint generated always as identity primary key,
    name              varchar(100) not null,
    value             jsonb,
    user_created_id   bigint       references users (id),
    user_created_date timestamptz  not null default now(),
    user_updated_id   bigint       references users (id),
    user_updated_date timestamptz
);

create unique index ux_setting_name on setting (name);
