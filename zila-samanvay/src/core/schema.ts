// Relational schema (SQLite). Indexes cover the filters the dashboard, drill-down,
// trackers and priority engine use most (block, department, status, current desk, dates).

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_hi TEXT NOT NULL,
  panchayats INTEGER NOT NULL, population INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_hi TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offices (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id), block_id INTEGER REFERENCES blocks(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, designation TEXT NOT NULL, role TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id), block_id INTEGER REFERENCES blocks(id),
  office_id INTEGER REFERENCES offices(id), phone TEXT, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL,
  scheme TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id),
  block_id INTEGER NOT NULL REFERENCES blocks(id), panchayat TEXT,
  sanctioned_lakh REAL NOT NULL, expenditure_lakh REAL NOT NULL DEFAULT 0, physical_pct REAL NOT NULL DEFAULT 0,
  agency TEXT, start_date TEXT, target_date TEXT, status TEXT NOT NULL,
  officer_id INTEGER REFERENCES users(id), next_action TEXT, next_action_due TEXT, hold_reason TEXT,
  public_approved INTEGER NOT NULL DEFAULT 0, public_summary TEXT, approved_by INTEGER, approved_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_works_block ON works(block_id, department_id);
CREATE INDEX IF NOT EXISTS ix_works_dept ON works(department_id, status);
CREATE INDEX IF NOT EXISTS ix_works_status ON works(status, target_date);
CREATE INDEX IF NOT EXISTS ix_works_public ON works(public_approved);

CREATE TABLE IF NOT EXISTS work_milestones (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, name TEXT NOT NULL, planned_date TEXT NOT NULL, actual_date TEXT, weight REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_milestones_work ON work_milestones(work_id, seq);

CREATE TABLE IF NOT EXISTS work_updates (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id INTEGER, at TEXT NOT NULL, physical_pct REAL NOT NULL, expenditure_lakh REAL NOT NULL,
  remark TEXT, source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS ix_updates_work ON work_updates(work_id, at);

CREATE TABLE IF NOT EXISTS schemes (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_hi TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id), indicator TEXT NOT NULL, unit TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 1, description TEXT
);

CREATE TABLE IF NOT EXISTS scheme_targets (
  id INTEGER PRIMARY KEY, scheme_id INTEGER NOT NULL REFERENCES schemes(id), block_id INTEGER NOT NULL REFERENCES blocks(id),
  fy TEXT NOT NULL, annual_target REAL NOT NULL, achieved REAL NOT NULL DEFAULT 0,
  officer_id INTEGER REFERENCES users(id), updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (scheme_id, block_id, fy)
);
CREATE INDEX IF NOT EXISTS ix_targets_block ON scheme_targets(block_id);

CREATE TABLE IF NOT EXISTS scheme_monthly (
  id INTEGER PRIMARY KEY, scheme_id INTEGER NOT NULL REFERENCES schemes(id), block_id INTEGER NOT NULL REFERENCES blocks(id),
  month TEXT NOT NULL, cumulative REAL NOT NULL, UNIQUE (scheme_id, block_id, month)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, file_no TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, category TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id), block_id INTEGER REFERENCES blocks(id),
  current_office_id INTEGER NOT NULL REFERENCES offices(id), current_holder_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', decision_required TEXT NOT NULL,
  sla_days INTEGER NOT NULL, amount_lakh REAL, work_id INTEGER REFERENCES works(id), asset_id INTEGER,
  opened_at TEXT NOT NULL, arrived_at TEXT NOT NULL, closed_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS ix_files_office ON files(current_office_id, status);
CREATE INDEX IF NOT EXISTS ix_files_holder ON files(current_holder_id, status);
CREATE INDEX IF NOT EXISTS ix_files_dept ON files(department_id, block_id);
CREATE INDEX IF NOT EXISTS ix_files_work ON files(work_id);

CREATE TABLE IF NOT EXISTS file_movements (
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, at TEXT NOT NULL,
  action TEXT NOT NULL, from_office_id INTEGER, to_office_id INTEGER, by_user_id INTEGER, to_user_id INTEGER, remark TEXT
);
CREATE INDEX IF NOT EXISTS ix_movements_file ON file_movements(file_id, at);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id), block_id INTEGER NOT NULL REFERENCES blocks(id),
  panchayat TEXT, village TEXT, officer_id INTEGER REFERENCES users(id),
  condition TEXT NOT NULL, functional_status TEXT NOT NULL, inspection_cycle_days INTEGER NOT NULL,
  last_inspected TEXT, next_inspection_due TEXT, public INTEGER NOT NULL DEFAULT 1,
  details TEXT, lat REAL, lng REAL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_assets_block ON assets(block_id, department_id);
CREATE INDEX IF NOT EXISTS ix_assets_condition ON assets(condition);
CREATE INDEX IF NOT EXISTS ix_assets_due ON assets(next_inspection_due);

CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL, conducted_date TEXT, inspector_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL, condition_found TEXT, remarks TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_inspections_asset ON inspections(asset_id, scheduled_date);
CREATE INDEX IF NOT EXISTS ix_inspections_inspector ON inspections(inspector_id, status);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  inspection_id INTEGER REFERENCES inspections(id), title TEXT NOT NULL, description TEXT,
  category TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL,
  responsible_department_id INTEGER REFERENCES departments(id), assigned_to INTEGER REFERENCES users(id),
  assigned_by INTEGER, due_date TEXT, reopen_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, closed_by INTEGER
);
CREATE INDEX IF NOT EXISTS ix_findings_asset ON findings(asset_id, status);
CREATE INDEX IF NOT EXISTS ix_findings_status ON findings(status, severity);
CREATE INDEX IF NOT EXISTS ix_findings_assignee ON findings(assigned_to, status);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data_url TEXT NOT NULL, sha256 TEXT,
  note TEXT, uploaded_by INTEGER, uploaded_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending', reviewed_by INTEGER, reviewed_at TEXT, review_remark TEXT
);
CREATE INDEX IF NOT EXISTS ix_evidence_entity ON evidence(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS initiatives (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, outcome TEXT NOT NULL,
  block_id INTEGER REFERENCES blocks(id), asset_id INTEGER REFERENCES assets(id),
  coordinator_id INTEGER REFERENCES users(id), target_date TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_links (
  id INTEGER PRIMARY KEY, initiative_id INTEGER NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  label TEXT NOT NULL, department_id INTEGER REFERENCES departments(id),
  ref_type TEXT NOT NULL, ref_id INTEGER NOT NULL, depends_on_link_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_links_initiative ON initiative_links(initiative_id);
CREATE INDEX IF NOT EXISTS ix_links_ref ON initiative_links(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, meeting_date TEXT NOT NULL, chaired_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL, minutes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY, meeting_id INTEGER REFERENCES meetings(id), agenda_key TEXT, agenda_category TEXT,
  title TEXT NOT NULL, decision TEXT NOT NULL, assigned_to INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER REFERENCES departments(id), block_id INTEGER REFERENCES blocks(id),
  deadline TEXT NOT NULL, status TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, progress_note TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, closed_by INTEGER
);
CREATE INDEX IF NOT EXISTS ix_actions_assignee ON action_items(assigned_to, status);
CREATE INDEX IF NOT EXISTS ix_actions_key ON action_items(agenda_key);
CREATE INDEX IF NOT EXISTS ix_actions_meeting ON action_items(meeting_id);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, dataset TEXT NOT NULL, file_name TEXT NOT NULL,
  total INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, failed INTEGER NOT NULL, errors TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, user_name TEXT, role TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, summary TEXT NOT NULL, details TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
`;
