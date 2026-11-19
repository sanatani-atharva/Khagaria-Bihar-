// Domain types shared by server, browser build and UI.

export type Role = 'dm' | 'ddc' | 'dept_officer' | 'block_officer';

export const ROLE_LABEL: Record<Role, string> = {
  dm: 'District Magistrate',
  ddc: 'Deputy Development Commissioner',
  dept_officer: 'District Department Officer',
  block_officer: 'Block / Field Officer',
};

export const EXECUTIVE_ROLES: Role[] = ['dm', 'ddc'];

export interface UserRow {
  id: number;
  name: string;
  designation: string;
  role: Role;
  department_id: number | null;
  block_id: number | null;
  office_id: number | null;
  phone: string | null;
  active: number;
}

export interface BlockRow {
  id: number;
  code: string;
  name: string;
  name_hi: string;
  panchayats: number;
  population: number;
}

export interface DepartmentRow {
  id: number;
  code: string;
  name: string;
  name_hi: string;
}

export interface OfficeRow {
  id: number;
  name: string;
  kind: 'district' | 'department' | 'block' | 'treasury';
  department_id: number | null;
  block_id: number | null;
}

export type WorkStatus = 'not_started' | 'in_progress' | 'stalled' | 'completed';
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  stalled: 'Stalled',
  completed: 'Completed',
};

export interface WorkRow {
  id: number;
  code: string;
  name: string;
  category: string;
  scheme: string;
  department_id: number;
  block_id: number;
  panchayat: string | null;
  sanctioned_lakh: number;
  expenditure_lakh: number;
  physical_pct: number;
  agency: string | null;
  start_date: string | null;
  target_date: string | null;
  status: WorkStatus;
  officer_id: number | null;
  next_action: string | null;
  next_action_due: string | null;
  hold_reason: string | null;
  public_approved: number;
  public_summary: string | null;
  approved_by: number | null;
  approved_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface MilestoneRow {
  id: number;
  work_id: number;
  seq: number;
  name: string;
  planned_date: string;
  actual_date: string | null;
  weight: number;
}

export interface SchemeRow {
  id: number;
  code: string;
  name: string;
  name_hi: string;
  department_id: number;
  indicator: string;
  unit: string;
  public: number;
  description: string | null;
}

export interface SchemeTargetRow {
  id: number;
  scheme_id: number;
  block_id: number;
  fy: string;
  annual_target: number;
  achieved: number;
  officer_id: number | null;
  updated_at: string;
  source: string;
}

export type FileStatus = 'open' | 'query' | 'approved' | 'closed';
export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  open: 'Pending decision',
  query: 'Query raised',
  approved: 'Approved',
  closed: 'Closed',
};

export type FileAction = 'created' | 'forwarded' | 'approved' | 'query' | 'replied' | 'returned' | 'closed';

export interface FileRow {
  id: number;
  file_no: string;
  subject: string;
  category: string;
  department_id: number;
  block_id: number | null;
  current_office_id: number;
  current_holder_id: number | null;
  status: FileStatus;
  priority: 'normal' | 'high' | 'urgent';
  decision_required: string;
  sla_days: number;
  amount_lakh: number | null;
  work_id: number | null;
  asset_id: number | null;
  opened_at: string;
  arrived_at: string;
  closed_at: string | null;
  created_by: number | null;
}

export type AssetCondition = 'good' | 'needs_repair' | 'critical';
export const CONDITION_LABEL: Record<AssetCondition, string> = {
  good: 'Good',
  needs_repair: 'Needs repair',
  critical: 'Critical',
};
export type FunctionalStatus = 'functional' | 'partially' | 'non_functional';
export const FUNCTIONAL_LABEL: Record<FunctionalStatus, string> = {
  functional: 'Functional',
  partially: 'Partially functional',
  non_functional: 'Non-functional',
};

export const ASSET_TYPE_LABEL: Record<string, string> = {
  school: 'School',
  awc: 'Anganwadi Centre',
  hsc: 'Health Sub-Centre / HWC',
  phc: 'Primary Health Centre',
  handpump: 'Handpump',
  water_scheme: 'Piped water scheme (Nal Jal)',
  panchayat_bhawan: 'Panchayat Sarkar Bhawan',
};

export interface AssetRow {
  id: number;
  code: string;
  name: string;
  type: string;
  department_id: number;
  block_id: number;
  panchayat: string | null;
  village: string | null;
  officer_id: number | null;
  condition: AssetCondition;
  functional_status: FunctionalStatus;
  inspection_cycle_days: number;
  last_inspected: string | null;
  next_inspection_due: string | null;
  public: number;
  details: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
}

export interface InspectionRow {
  id: number;
  asset_id: number;
  scheduled_date: string;
  conducted_date: string | null;
  inspector_id: number | null;
  status: 'scheduled' | 'completed' | 'missed';
  condition_found: AssetCondition | null;
  remarks: string | null;
  created_at: string;
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'assigned' | 'resolution_submitted' | 'closed';
export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open — action not assigned',
  assigned: 'Corrective action assigned',
  resolution_submitted: 'Evidence submitted — awaiting verification',
  closed: 'Verified & closed',
};

export interface FindingRow {
  id: number;
  asset_id: number;
  inspection_id: number | null;
  title: string;
  description: string | null;
  category: string;
  severity: Severity;
  status: FindingStatus;
  responsible_department_id: number | null;
  assigned_to: number | null;
  assigned_by: number | null;
  due_date: string | null;
  reopen_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: number | null;
}

export interface EvidenceMeta {
  id: number;
  entity_type: 'finding' | 'action' | 'work';
  entity_id: number;
  file_name: string;
  mime: string;
  size: number;
  sha256: string | null;
  note: string | null;
  uploaded_by: number | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  review_status: 'pending' | 'accepted' | 'rejected';
  reviewed_by: number | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_remark: string | null;
}

export type ActionStatus = 'open' | 'in_progress' | 'resolution_submitted' | 'closed' | 'reopened';
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolution_submitted: 'Evidence submitted',
  closed: 'Verified & closed',
  reopened: 'Reopened',
};

export interface ActionItemRow {
  id: number;
  meeting_id: number | null;
  agenda_key: string | null;
  agenda_category: string | null;
  title: string;
  decision: string;
  assigned_to: number;
  department_id: number | null;
  block_id: number | null;
  deadline: string;
  status: ActionStatus;
  ref_type: string | null;
  ref_id: number | null;
  progress_note: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: number | null;
}

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'critical' | 'muted';

/** A uniform "thing that needs attention", used by drill-down, heatmap and officer desk. */
export interface IssueItem {
  key: string; // e.g. 'work:12'
  type: 'work' | 'file' | 'finding' | 'scheme_gap' | 'asset' | 'inspection' | 'action';
  refId: number;
  title: string;
  subtitle: string;
  blockId: number | null;
  blockName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  officerId: number | null;
  officerName: string | null;
  officerDesignation: string | null;
  officerPhone: string | null;
  nextAction: string;
  dueDate: string | null;
  status: string;
  tone: Tone;
  metric: string;
  link: string;
}

export type AgendaCategory = 'work_delay' | 'file_delay' | 'critical_finding' | 'service_gap' | 'coordination';
export const AGENDA_CATEGORY_LABEL: Record<AgendaCategory, string> = {
  work_delay: 'Persistent work delay',
  file_delay: 'Decision pending beyond SLA',
  critical_finding: 'Unresolved inspection finding',
  service_gap: 'Block-level service gap',
  coordination: 'Inter-department coordination',
};

export interface AgendaFactor {
  label: string;
  points: number;
}

export interface AgendaItem {
  key: string;
  category: AgendaCategory;
  title: string;
  blockId: number | null;
  blockName: string | null;
  departmentIds: number[];
  departmentNames: string[];
  officerId: number | null;
  officerName: string | null;
  officerDesignation: string | null;
  score: number;
  band: 'critical' | 'high' | 'medium';
  reasons: string[];
  factors: AgendaFactor[];
  suggestedAction: string;
  suggestedDeadlineDays: number;
  refType: string;
  refId: number;
  link: string;
  timesFlaggedBefore: number;
  openActions: { id: number; status: ActionStatus; deadline: string; assignee: string; overdue: boolean }[];
  relatedKeys: string[];
}
