-- Built-in roles.
insert into role (title, description, permissions) values
    ('Administrator', 'Full access, including SMTP settings and system configuration.', '{Ingest,Read,Write,Project,Organization,System}'),
    ('Organization Owner', 'Project Owner permissions plus user management.', '{Ingest,Read,Write,Project,Organization}'),
    ('Project Owner', 'User permissions plus API keys, retention, alerts and shared signals.', '{Ingest,Read,Write,Project}'),
    ('User (read/write)', 'Read events and manage personal signals.', '{Read,Write}'),
    ('User (read-only)', 'Read events, dashboards and alerts.', '{Read}');
