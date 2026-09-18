-- operators_alerted_at was doing two jobs: "operators know this trip is overdue" and
-- "operators know this trip called for help". requestHelp cleared it to retry the help
-- push, which threw away the overdue record and produced a second overdue alert once a
-- help call was cancelled. Help alerts get their own column.
ALTER TABLE trips ADD COLUMN help_alerted_at INTEGER;
UPDATE trips SET help_alerted_at = operators_alerted_at WHERE status = 'help' AND operators_alerted_at IS NOT NULL;
