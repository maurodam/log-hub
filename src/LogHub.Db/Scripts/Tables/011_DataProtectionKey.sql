-- ASP.NET Core Data Protection key ring (session cookies, antiforgery tokens, encrypted settings).
-- Shared by all replicas, so sessions survive restarts and scale-out.
create table data_protection_key (
    id                bigint generated always as identity primary key,
    friendly_name     varchar(200),
    xml               text         not null,
    user_created_id   bigint       references users (id),
    user_created_date timestamptz  not null default now(),
    user_updated_id   bigint       references users (id),
    user_updated_date timestamptz
);
