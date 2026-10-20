-- Keys used by applications to send events (X-Seq-ApiKey header or ?apiKey= query).
-- The full token is shown once at creation; only its hash and first characters are stored.
create table api_key (
    id                    bigint generated always as identity primary key,
    title                 varchar(200) not null,
    token_hash            varchar(128),
    token_prefix          varchar(8),
    permissions           text[]       not null default '{}',
    minimum_level         varchar(20),
    filter                text,
    applied_properties    jsonb        not null default '{}',
    use_server_timestamps boolean      not null default false,
    is_default            boolean      not null default false,
    owner_id              bigint       references users (id) on delete cascade,
    user_created_id       bigint       references users (id),
    user_created_date     timestamptz  not null default now(),
    user_updated_id       bigint       references users (id),
    user_updated_date     timestamptz
);

create unique index ux_api_key_token_hash on api_key (token_hash) where token_hash is not null;
-- At most one default key: it holds the settings for events sent without a key.
create unique index ux_api_key_is_default on api_key (is_default) where is_default;
