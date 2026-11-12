-- Allowed values for enum-like columns, applied every time the database is opened (statements are idempotent).
-- Triggers rather than CHECK constraints: SQLite can only add a CHECK by rebuilding the table, and triggers also
-- cover databases that already hold rows. Statements are separated by a blank line.

CREATE TRIGGER IF NOT EXISTS household_members_role_valid_insert BEFORE INSERT ON household_members
WHEN NEW.role NOT IN ('admin', 'member', 'guest')
BEGIN SELECT RAISE(ABORT, 'household_members.role is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS household_members_role_valid_update BEFORE UPDATE OF role ON household_members
WHEN NEW.role NOT IN ('admin', 'member', 'guest')
BEGIN SELECT RAISE(ABORT, 'household_members.role is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS invitations_role_valid_insert BEFORE INSERT ON invitations
WHEN NEW.role NOT IN ('admin', 'member', 'guest')
BEGIN SELECT RAISE(ABORT, 'invitations.role is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS invitations_role_valid_update BEFORE UPDATE OF role ON invitations
WHEN NEW.role NOT IN ('admin', 'member', 'guest')
BEGIN SELECT RAISE(ABORT, 'invitations.role is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS commands_state_valid_insert BEFORE INSERT ON commands
WHEN NEW.state NOT IN ('pending', 'authorized', 'dispatched', 'accepted', 'confirmed', 'failed', 'timed_out', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'commands.state is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS commands_state_valid_update BEFORE UPDATE OF state ON commands
WHEN NEW.state NOT IN ('pending', 'authorized', 'dispatched', 'accepted', 'confirmed', 'failed', 'timed_out', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'commands.state is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS commands_source_valid_insert BEFORE INSERT ON commands
WHEN NEW.source NOT IN ('user', 'automation', 'ai', 'job')
BEGIN SELECT RAISE(ABORT, 'commands.source is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS commands_source_valid_update BEFORE UPDATE OF source ON commands
WHEN NEW.source NOT IN ('user', 'automation', 'ai', 'job')
BEGIN SELECT RAISE(ABORT, 'commands.source is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_status_valid_insert BEFORE INSERT ON backup_records
WHEN NEW.status NOT IN ('running', 'ok', 'failed')
BEGIN SELECT RAISE(ABORT, 'backup_records.status is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_status_valid_update BEFORE UPDATE OF status ON backup_records
WHEN NEW.status NOT IN ('running', 'ok', 'failed')
BEGIN SELECT RAISE(ABORT, 'backup_records.status is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS config_jobs_status_valid_insert BEFORE INSERT ON config_jobs
WHEN NEW.status NOT IN ('pending', 'running', 'done', 'failed')
BEGIN SELECT RAISE(ABORT, 'config_jobs.status is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS config_jobs_status_valid_update BEFORE UPDATE OF status ON config_jobs
WHEN NEW.status NOT IN ('pending', 'running', 'done', 'failed')
BEGIN SELECT RAISE(ABORT, 'config_jobs.status is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS routine_runs_state_valid_insert BEFORE INSERT ON routine_runs
WHEN NEW.state NOT IN ('running', 'completed', 'failed', 'stopped', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'routine_runs.state is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS routine_runs_state_valid_update BEFORE UPDATE OF state ON routine_runs
WHEN NEW.state NOT IN ('running', 'completed', 'failed', 'stopped', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'routine_runs.state is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS push_subscriptions_platform_valid_insert BEFORE INSERT ON push_subscriptions
WHEN NEW.platform NOT IN ('webpush', 'fcm')
BEGIN SELECT RAISE(ABORT, 'push_subscriptions.platform is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS push_subscriptions_platform_valid_update BEFORE UPDATE OF platform ON push_subscriptions
WHEN NEW.platform NOT IN ('webpush', 'fcm')
BEGIN SELECT RAISE(ABORT, 'push_subscriptions.platform is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS alerts_kind_valid_insert BEFORE INSERT ON alerts
WHEN NEW.kind NOT IN ('power_limit', 'left_open')
BEGIN SELECT RAISE(ABORT, 'alerts.kind is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS alerts_kind_valid_update BEFORE UPDATE OF kind ON alerts
WHEN NEW.kind NOT IN ('power_limit', 'left_open')
BEGIN SELECT RAISE(ABORT, 'alerts.kind is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_kind_valid_insert BEFORE INSERT ON backup_records
WHEN NEW.kind NOT IN ('app', 'ha')
BEGIN SELECT RAISE(ABORT, 'backup_records.kind is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_kind_valid_update BEFORE UPDATE OF kind ON backup_records
WHEN NEW.kind NOT IN ('app', 'ha')
BEGIN SELECT RAISE(ABORT, 'backup_records.kind is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_verify_status_valid_insert BEFORE INSERT ON backup_records
WHEN NEW.verify_status NOT IN ('none', 'running', 'passed', 'failed')
BEGIN SELECT RAISE(ABORT, 'backup_records.verify_status is not an allowed value'); END;

CREATE TRIGGER IF NOT EXISTS backup_records_verify_status_valid_update BEFORE UPDATE OF verify_status ON backup_records
WHEN NEW.verify_status NOT IN ('none', 'running', 'passed', 'failed')
BEGIN SELECT RAISE(ABORT, 'backup_records.verify_status is not an allowed value'); END;
