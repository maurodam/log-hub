-- Portal users. Plural because user is a reserved word in PostgreSQL.
create table users (
    id                   bigint generated always as identity primary key,
    username             varchar(100) not null,
    display_name         varchar(200),
    email                varchar(320),
    password_hash        varchar(500),
    auth_provider        varchar(50)  not null default 'Local',
    external_id          varchar(200),
    must_change_password boolean      not null default false,
    is_disabled          boolean      not null default false,
    security_stamp       varchar(64)  not null default md5(random()::text), -- changes on password/role change: invalidates sessions
    failed_login_count   integer      not null default 0,
    lockout_end          timestamptz,
    last_login_date      timestamptz,
    user_created_id      bigint       references users (id),
    user_created_date    timestamptz  not null default now(),
    user_updated_id      bigint       references users (id),
    user_updated_date    timestamptz
);

create unique index ux_users_username on users (lower(username));
create unique index ux_users_external on users (auth_provider, external_id) where external_id is not null;
