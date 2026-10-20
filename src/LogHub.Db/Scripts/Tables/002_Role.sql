-- Named permission sets. Permissions: Ingest, Read, Write, Project, Organization, System.
create table role (
    id                bigint generated always as identity primary key,
    title             varchar(100) not null,
    description       varchar(500),
    permissions       text[]       not null default '{}',
    user_created_id   bigint       references users (id),
    user_created_date timestamptz  not null default now(),
    user_updated_id   bigint       references users (id),
    user_updated_date timestamptz
);

create unique index ux_role_title on role (title);
