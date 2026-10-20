-- Built-in shared signals.
insert into signal (title, description, filter, group_name, is_protected) values
    ('Errors', 'Error and Fatal events', '{"levels":["Error","Fatal"]}', 'Level', true),
    ('Warnings', 'Warning events', '{"levels":["Warning"]}', 'Level', true),
    ('Exceptions', 'Events with an exception', '{"hasException":true}', null, true);
