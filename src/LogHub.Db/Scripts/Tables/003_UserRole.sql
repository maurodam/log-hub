-- Roles assigned to each user.
create table user_role (
    id                bigint generated always as identity primary key,
    user_id           bigint      not null references users (id) on delete cascade,
    role_id           bigint      not null references role (id) on delete cascade,
    user_created_id   bigint      references users (id),
    user_created_date timestamptz not null default now(),
    user_updated_id   bigint      references users (id),
    user_updated_date timestamptz
);

create unique index ux_user_role_user_id_role_id on user_role (user_id, role_id);
create index ix_user_role_role_id on user_role (role_id);
