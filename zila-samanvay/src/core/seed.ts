// Deterministic, realistic demo dataset for Khagaria district.
// Block and department names are real; every person, phone number, file number, amount and
// record is SYNTHETIC and exists only to demonstrate the workflows. All dates are generated
// relative to the seeding date so ageing, SLA breaches and overdue items stay realistic.

import type { Db } from './db';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { insert } from './sql';
import { addDays, daysBetween, financialYear, fyMonths, fyMonthNumber, fyMonthsElapsed, ymd } from './time';

// ---------- deterministic randomness ----------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- reference data ----------
export const BLOCKS = [
  { code: 'KHG', name: 'Khagaria', name_hi: 'खगड़िया', panchayats: 23, population: 452000, villages: ['Rahimpur', 'Sanhauli', 'Kosra', 'Mathurapur', 'Ranko', 'Bachhauta'] },
  { code: 'ALA', name: 'Alauli', name_hi: 'अलौली', panchayats: 20, population: 318000, villages: ['Raunia', 'Sahsi', 'Harpur', 'Meghauna', 'Shumbha', 'Alauli'] },
  { code: 'CHT', name: 'Chautham', name_hi: 'चौथम', panchayats: 15, population: 201000, villages: ['Rohiyar', 'Malpa', 'Thutha', 'Bordiha', 'Dhamara', 'Chautham'] },
  { code: 'BEL', name: 'Beldaur', name_hi: 'बेलदौर', panchayats: 16, population: 236000, villages: ['Tilathi', 'Kanchanpur', 'Balthi', 'Pachaut', 'Itahri', 'Beldaur'] },
  { code: 'GOG', name: 'Gogri', name_hi: 'गोगरी', panchayats: 19, population: 389000, villages: ['Maheshkhunt', 'Pasraha', 'Ramnagar', 'Pakrail', 'Bhorkhaila', 'Sherchakla'] },
  { code: 'MAN', name: 'Mansi', name_hi: 'मानसी', panchayats: 7, population: 112000, villages: ['Amni', 'Ekania', 'Thatha', 'Balha', 'Chakhuseni', 'Mansi'] },
  { code: 'PAR', name: 'Parbatta', name_hi: 'परबत्ता', panchayats: 23, population: 351000, villages: ['Sorha', 'Kabela', 'Bhasar', 'Teghra', 'Kolwara', 'Parbatta'] },
];

export const DEPARTMENTS = [
  { code: 'EDU', name: 'Education', name_hi: 'शिक्षा विभाग' },
  { code: 'RWD', name: 'Rural Works', name_hi: 'ग्रामीण कार्य विभाग' },
  { code: 'PHED', name: 'Public Health Engineering (PHED)', name_hi: 'लोक स्वास्थ्य अभियंत्रण विभाग' },
  { code: 'HLT', name: 'Health', name_hi: 'स्वास्थ्य विभाग' },
  { code: 'PRD', name: 'Panchayati Raj', name_hi: 'पंचायती राज विभाग' },
  { code: 'REV', name: 'Revenue & Land Reforms', name_hi: 'राजस्व एवं भूमि सुधार विभाग' },
  { code: 'ICDS', name: 'Social Welfare (ICDS)', name_hi: 'समाज कल्याण विभाग (आईसीडीएस)' },
  { code: 'RDD', name: 'Rural Development', name_hi: 'ग्रामीण विकास विभाग' },
  { code: 'FIN', name: 'Finance (District Treasury)', name_hi: 'वित्त विभाग (जिला कोषागार)' },
];

const AGENCIES = [
  'M/s Kosi Infra Constructions',
  'M/s Ganga Builders, Begusarai',
  'M/s Shree Ram Enterprises',
  'M/s Mithila Construction Co.',
  'M/s Bagmati Projects Pvt. Ltd.',
  'M/s Anand Engicon',
  'Departmental (Vibhagiya)',
];

const MILESTONES: Record<string, string[]> = {
  road: ['Survey, DPR & alignment', 'Earthwork & embankment', 'Sub-base (GSB / WBM)', 'Bituminous surfacing', 'Road furniture & handover'],
  building: ['Foundation', 'Plinth & DPC', 'Superstructure & roof casting', 'Plaster, flooring & finishing', 'Electrification & handover'],
  water: ['Boring & pump house', 'Overhead tank / storage', 'Distribution pipeline', 'Household connections', 'Trial run & handover to ward committee'],
  light: ['Pole procurement', 'Installation', 'Commissioning & handover'],
};

function svgEvidence(title: string, line2: string, line3: string, color = '#0f766e'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#e2e8f0"/><rect x="0" y="330" width="800" height="170" fill="#94a3b8"/><rect x="150" y="150" width="500" height="200" fill="#cbd5e1" stroke="#475569" stroke-width="4"/><polygon points="130,160 400,60 670,160" fill="${color}"/><rect x="360" y="250" width="80" height="100" fill="#64748b"/><rect x="0" y="420" width="800" height="80" fill="rgba(15,23,42,.82)"/><text x="24" y="452" font-family="Arial, sans-serif" font-size="22" fill="#fff">${esc(title)}</text><text x="24" y="482" font-family="Arial, sans-serif" font-size="16" fill="#cbd5e1">${esc(line2)} · ${esc(line3)}</text><text x="776" y="40" text-anchor="end" font-family="Arial, sans-serif" font-size="16" fill="#334155">DEMO EVIDENCE PHOTO</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function initSchema(db: Db) {
  db.exec(SCHEMA_SQL);
}

export function isSeeded(db: Db): boolean {
  try {
    return !!db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seeded_at'");
  } catch {
    return false;
  }
}

const WIPE_ORDER = [
  'audit_log', 'import_batches', 'evidence', 'action_items', 'meetings', 'initiative_links', 'initiatives',
  'file_movements', 'files', 'findings', 'inspections', 'assets', 'scheme_monthly', 'scheme_targets', 'schemes',
  'work_updates', 'work_milestones', 'works', 'users', 'offices', 'departments', 'blocks', 'meta',
];

export function wipe(db: Db) {
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of WIPE_ORDER) db.exec(`DELETE FROM ${t};`);
  db.exec('PRAGMA foreign_keys = ON;');
}

export function seed(db: Db, now: Date = new Date()) {
  const R = mulberry32(20261201);
  const rand = (min: number, max: number) => min + (max - min) * R();
  const randint = (min: number, max: number) => Math.floor(rand(min, max + 1));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(R() * arr.length)];
  const chance = (p: number) => R() < p;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const today = ymd(now);
  const ago = (n: number) => addDays(today, -n);
  const ahead = (n: number) => addDays(today, n);
  const nowIso = now.toISOString();
  // Office hours in India Standard Time, stored as UTC ISO strings.
  const ts = (dateStr: string, hour = 11, min = 0) => {
    const s = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+05:30`).toISOString();
    return s > nowIso ? nowIso : s;
  };
  const fy = financialYear(today);

  db.transaction(() => {
    // ---------- blocks, departments ----------
    const blockId: Record<string, number> = {};
    const villagesOf: Record<number, string[]> = {};
    for (const b of BLOCKS) {
      const id = insert(db, 'blocks', { code: b.code, name: b.name, name_hi: b.name_hi, panchayats: b.panchayats, population: b.population });
      blockId[b.code] = id;
      villagesOf[id] = b.villages;
    }
    const deptId: Record<string, number> = {};
    for (const d of DEPARTMENTS) deptId[d.code] = insert(db, 'departments', d);
    const D = deptId;
    const B = blockId;

    // ---------- offices (desks where files sit) ----------
    const office: Record<string, number> = {};
    const addOffice = (key: string, name: string, kind: string, dept: number | null, block: number | null) =>
      (office[key] = insert(db, 'offices', { name, kind, department_id: dept, block_id: block }));
    addOffice('DM', 'Office of the District Magistrate', 'district', null, null);
    addOffice('DDC', 'DDC Office (District Development Section)', 'district', null, null);
    addOffice('TRE', 'District Treasury', 'treasury', D.FIN, null);
    addOffice('DEO', 'District Education Office', 'department', D.EDU, null);
    addOffice('SSA', 'DPO Samagra Shiksha', 'department', D.EDU, null);
    addOffice('PHED', 'EE, PHED Division Khagaria', 'department', D.PHED, null);
    addOffice('CS', 'Office of the Civil Surgeon', 'department', D.HLT, null);
    addOffice('RWD', 'EE, RWD Works Division Khagaria', 'department', D.RWD, null);
    addOffice('DPRO', 'District Panchayat Raj Office', 'department', D.PRD, null);
    addOffice('ADMR', 'ADM (Revenue) / DCLR', 'department', D.REV, null);
    addOffice('ICDS', 'DPO ICDS', 'department', D.ICDS, null);
    addOffice('DRDA', 'District Rural Development Agency', 'department', D.RDD, null);
    for (const b of BLOCKS) addOffice(`BLK_${b.code}`, `Block Office, ${b.name}`, 'block', null, B[b.code]);
    addOffice('CO_GOG', 'Circle Office, Gogri', 'block', D.REV, B.GOG);
    addOffice('CO_ALA', 'Circle Office, Alauli', 'block', D.REV, B.ALA);

    // ---------- users (fictional demo personas) ----------
    const U: Record<string, number> = {};
    let phoneSeq = 1;
    const addUser = (key: string, name: string, designation: string, role: string, dept: number | null, block: number | null, off: number | null) => {
      U[key] = insert(db, 'users', {
        name, designation, role, department_id: dept, block_id: block, office_id: off,
        phone: `+91 90000 ${String(10000 + phoneSeq++).slice(1)}`, active: 1,
      });
    };
    addUser('DM', 'Vivek Ranjan', 'District Magistrate', 'dm', null, null, office.DM);
    addUser('DDC', 'Meenakshi Prasad', 'Deputy Development Commissioner', 'ddc', null, null, office.DDC);
    addUser('DEO', 'Rajeev Ranjan Jha', 'District Education Officer', 'dept_officer', D.EDU, null, office.DEO);
    addUser('SSA', 'Sushma Kumari', 'DPO, Samagra Shiksha', 'dept_officer', D.EDU, null, office.SSA);
    addUser('EEPHED', 'Anil Kumar Mandal', 'Executive Engineer, PHED', 'dept_officer', D.PHED, null, office.PHED);
    addUser('CS', 'Dr. Shahnawaz Alam', 'Civil Surgeon', 'dept_officer', D.HLT, null, office.CS);
    addUser('EERWD', 'Pramod Kumar Singh', 'Executive Engineer, RWD', 'dept_officer', D.RWD, null, office.RWD);
    addUser('DPRO', 'Kavita Bharti', 'District Panchayat Raj Officer', 'dept_officer', D.PRD, null, office.DPRO);
    addUser('ADMR', 'Manoj Kumar Choudhary', 'ADM (Revenue)', 'dept_officer', D.REV, null, office.ADMR);
    addUser('DPOICDS', 'Nisha Rani', 'DPO, ICDS', 'dept_officer', D.ICDS, null, office.ICDS);
    addUser('DRDA', 'Santosh Kumar Yadav', 'Director, DRDA', 'dept_officer', D.RDD, null, office.DRDA);
    addUser('DTO', 'Rakesh Kumar Gupta', 'District Treasury Officer', 'dept_officer', D.FIN, null, office.TRE);
    const bdoNames: Record<string, string> = {
      KHG: 'Amit Kumar', ALA: 'Priyanka Kumari', CHT: 'Ravi Shankar Paswan', BEL: 'Md. Tanveer Ahmad',
      GOG: 'Dilip Kumar Sah', MAN: 'Rekha Sinha', PAR: 'Ajay Kumar Thakur',
    };
    for (const b of BLOCKS) addUser(`BDO_${b.code}`, bdoNames[b.code], `Block Development Officer, ${b.name}`, 'block_officer', null, B[b.code], office[`BLK_${b.code}`]);
    addUser('BEO_ALA', 'Sunil Kumar Das', 'Block Education Officer, Alauli', 'block_officer', D.EDU, B.ALA, office.BLK_ALA);
    addUser('BEO_KHG', 'Mamta Kumari', 'Block Education Officer, Khagaria', 'block_officer', D.EDU, B.KHG, office.BLK_KHG);
    addUser('JE_ALA', 'Vikash Kumar', 'Junior Engineer, PHED (Alauli)', 'block_officer', D.PHED, B.ALA, office.BLK_ALA);
    addUser('JE_GOG', 'Raju Ranjan', 'Junior Engineer, PHED (Gogri)', 'block_officer', D.PHED, B.GOG, office.BLK_GOG);
    addUser('MOIC_ALA', 'Dr. Neha Bharti', 'MOIC, PHC Alauli', 'block_officer', D.HLT, B.ALA, office.BLK_ALA);
    addUser('MOIC_BEL', 'Dr. Rohit Raj', 'MOIC, PHC Beldaur', 'block_officer', D.HLT, B.BEL, office.BLK_BEL);
    addUser('CDPO_ALA', 'Seema Kumari', 'CDPO, Alauli', 'block_officer', D.ICDS, B.ALA, office.BLK_ALA);
    addUser('CDPO_PAR', 'Pooja Bharti', 'CDPO, Parbatta', 'block_officer', D.ICDS, B.PAR, office.BLK_PAR);
    addUser('AE_GOG', 'Saurabh Kumar', 'Assistant Engineer, RWD (Gogri)', 'block_officer', D.RWD, B.GOG, office.BLK_GOG);
    addUser('BPRO_CHT', 'Nitesh Kumar', 'Block Panchayat Raj Officer, Chautham', 'block_officer', D.PRD, B.CHT, office.BLK_CHT);
    addUser('CO_GOG', 'Arun Kumar Rai', 'Circle Officer, Gogri', 'block_officer', D.REV, B.GOG, office.CO_GOG);
    addUser('CO_ALA', 'Kumari Anjali', 'Circle Officer, Alauli', 'block_officer', D.REV, B.ALA, office.CO_ALA);

    const districtHead: Record<string, number> = {
      EDU: U.SSA, RWD: U.EERWD, PHED: U.EEPHED, HLT: U.CS, PRD: U.DPRO, REV: U.ADMR, ICDS: U.DPOICDS, RDD: U.DRDA, FIN: U.DTO,
    };
    const fieldOfficer: Record<string, number> = {
      'EDU:ALA': U.BEO_ALA, 'EDU:KHG': U.BEO_KHG, 'PHED:ALA': U.JE_ALA, 'PHED:GOG': U.JE_GOG, 'HLT:ALA': U.MOIC_ALA,
      'HLT:BEL': U.MOIC_BEL, 'ICDS:ALA': U.CDPO_ALA, 'ICDS:PAR': U.CDPO_PAR, 'RWD:GOG': U.AE_GOG, 'PRD:CHT': U.BPRO_CHT,
      'REV:GOG': U.CO_GOG, 'REV:ALA': U.CO_ALA,
    };
    const responsible = (dept: string, block: string) => fieldOfficer[`${dept}:${block}`] ?? districtHead[dept];
    const holderOfOffice = (officeId: number): number | null =>
      db.get<{ id: number }>('SELECT id FROM users WHERE office_id = ? ORDER BY CASE role WHEN \'dm\' THEN 0 WHEN \'ddc\' THEN 0 WHEN \'dept_officer\' THEN 1 ELSE 2 END, designation LIKE \'Block Development%\' DESC, id LIMIT 1', [officeId])?.id ?? null;
    const deptOffice: Record<string, number> = {
      EDU: office.SSA, RWD: office.RWD, PHED: office.PHED, HLT: office.CS, PRD: office.DPRO, REV: office.ADMR, ICDS: office.ICDS, RDD: office.DRDA, FIN: office.TRE,
    };
    const blockCodeOf = (id: number) => BLOCKS.find((b) => B[b.code] === id)!.code;

    const audit = (at: string, userKey: number | null, action: string, entity: string, entityId: number | null, summary: string) => {
      const u = userKey ? db.get<{ name: string; role: string }>('SELECT name, role FROM users WHERE id = ?', [userKey]) : undefined;
      insert(db, 'audit_log', { at, user_id: userKey, user_name: u?.name ?? 'System', role: u?.role ?? 'system', action, entity_type: entity, entity_id: entityId, summary, details: null });
    };

    // ---------- non-works schemes: block-wise targets & monthly progress ----------
    const SCHEMES = [
      { code: 'HLT-FIC', dept: 'HLT', name: 'Full Immunisation Coverage', name_hi: 'पूर्ण टीकाकरण', indicator: 'Children (0–1 yr) fully immunised', unit: 'children', rate: 0.0255 },
      { code: 'HLT-INST', dept: 'HLT', name: 'Institutional Deliveries', name_hi: 'संस्थागत प्रसव', indicator: 'Deliveries in public health facilities', unit: 'deliveries', rate: 0.021 },
      { code: 'EDU-DBT', dept: 'EDU', name: 'Scholarship & Poshak DBT Disbursal', name_hi: 'छात्रवृत्ति एवं पोशाक डीबीटी', indicator: 'Students paid through DBT', unit: 'students', rate: 0.085 },
      { code: 'SW-PEN', dept: 'ICDS', name: 'Social Security Pension Verification', name_hi: 'सामाजिक सुरक्षा पेंशन सत्यापन', indicator: 'Pensioners with life certificate / e-KYC verified', unit: 'pensioners', rate: 0.068 },
      { code: 'PHED-WQT', dept: 'PHED', name: 'Drinking Water Quality Testing', name_hi: 'पेयजल गुणवत्ता जाँच', indicator: 'Water sources tested (FTK + lab)', unit: 'sources', rate: 0.0042 },
      { code: 'ICDS-THR', dept: 'ICDS', name: 'Take-Home Ration Coverage', name_hi: 'टेक-होम राशन', indicator: 'Beneficiaries receiving THR', unit: 'beneficiaries', rate: 0.044 },
      { code: 'RDD-PMAY', dept: 'RDD', name: 'PMAY-G House Completion', name_hi: 'प्रधानमंत्री आवास योजना (ग्रामीण)', indicator: 'Houses completed & geo-tagged', unit: 'houses', rate: 0.0036 },
      { code: 'REV-MUT', dept: 'REV', name: 'Mutation (Dakhil-Kharij) Disposal', name_hi: 'दाखिल-खारिज निष्पादन', indicator: 'Cases disposed within RTPS timeline', unit: 'cases', rate: 0.011 },
    ];
    const gapOverrides: Record<string, number> = {
      'HLT-FIC:ALA': 0.58, 'SW-PEN:BEL': 0.61, 'PHED-WQT:MAN': 0.66, 'EDU-DBT:CHT': 0.64, 'ICDS-THR:PAR': 0.72, 'REV-MUT:GOG': 0.69,
    };
    const months = fyMonths(today);
    const elapsed = fyMonthsElapsed(today);
    for (const s of SCHEMES) {
      const sid = insert(db, 'schemes', {
        code: s.code, name: s.name, name_hi: s.name_hi, department_id: D[s.dept], indicator: s.indicator, unit: s.unit, public: 1,
        description: `Block-wise annual target vs cumulative achievement for FY ${fy}.`,
      });
      for (const b of BLOCKS) {
        const target = Math.round(b.population * s.rate * rand(0.92, 1.08));
        const override = gapOverrides[`${s.code}:${b.code}`];
        const base = override ?? rand(0.8, 1.08);
        let achieved = 0;
        months.forEach((m, i) => {
          const isLast = i === months.length - 1;
          const share = isLast ? elapsed / 12 : fyMonthNumber(m) / 12;
          // gap blocks drift a little worse over time; others wobble
          const ratio = override ? base + (months.length - i) * 0.012 + rand(-0.01, 0.01) : base + rand(-0.04, 0.04);
          const cumulative = Math.max(0, Math.round(target * share * Math.min(ratio, 1.12)));
          achieved = Math.max(achieved, cumulative);
          insert(db, 'scheme_monthly', { scheme_id: sid, block_id: B[b.code], month: m, cumulative: achieved });
        });
        insert(db, 'scheme_targets', {
          scheme_id: sid, block_id: B[b.code], fy, annual_target: target, achieved,
          officer_id: responsible(s.dept, b.code), updated_at: ts(ago(randint(1, 9))), source: chance(0.5) ? 'import' : 'manual',
        });
      }
    }

    // ---------- public works ----------
    const workId: Record<string, number> = {};
    let workSeq = 1;
    interface WorkSpec {
      key?: string; dept: string; block: string; panchayat: string; name: string; category: string; scheme: string; kind: keyof typeof MILESTONES;
      sanctioned: number; expenditure: number; physical: number; agency: string; start: string; target: string;
      status: 'not_started' | 'in_progress' | 'stalled' | 'completed'; officer: number; nextAction: string | null; nextDue: string | null;
      hold: string | null; publicApproved: boolean; publicSummary: string | null; updatedAgo: number; source?: string;
    }
    const addWork = (w: WorkSpec) => {
      const code = `${w.dept}/${w.block}/${financialYear(w.start)}/${String(workSeq++).padStart(3, '0')}`;
      const id = insert(db, 'works', {
        code, name: w.name, category: w.category, scheme: w.scheme, department_id: D[w.dept], block_id: B[w.block], panchayat: w.panchayat,
        sanctioned_lakh: w.sanctioned, expenditure_lakh: w.expenditure, physical_pct: w.physical, agency: w.agency,
        start_date: w.start, target_date: w.target, status: w.status, officer_id: w.officer, next_action: w.nextAction,
        next_action_due: w.nextDue, hold_reason: w.hold, public_approved: w.publicApproved ? 1 : 0, public_summary: w.publicSummary,
        approved_by: w.publicApproved ? U.DDC : null, approved_at: w.publicApproved ? ts(ago(randint(10, 60))) : null,
        source: w.source ?? (chance(0.45) ? 'import:RWD_PHED_progress_Oct2026.csv' : 'manual'),
        created_at: ts(w.start), updated_at: ts(ago(w.updatedAgo), randint(9, 17), randint(0, 59)),
      });
      if (w.key) workId[w.key] = id;
      // milestones
      const names = MILESTONES[w.kind];
      const span = Math.max(30, daysBetween(w.start, w.target));
      const weight = 100 / names.length;
      names.forEach((n, i) => {
        const planned = addDays(w.start, Math.round((span * (i + 1)) / names.length));
        const done = w.physical >= weight * (i + 1) - 0.01;
        const actual = done ? addDays(planned, randint(-5, w.status === 'stalled' || w.physical < 60 ? 40 : 15)) : null;
        insert(db, 'work_milestones', { work_id: id, seq: i + 1, name: n, planned_date: planned, actual_date: actual && actual <= today ? actual : done ? today : null, weight: r1(weight) });
      });
      // progress history
      const steps = w.physical > 0 ? randint(2, 4) : 0;
      for (let i = 1; i <= steps; i++) {
        const p = r1((w.physical * i) / steps);
        const at = ago(w.updatedAgo + (steps - i) * randint(18, 32));
        if (at < w.start) continue;
        insert(db, 'work_updates', {
          work_id: id, user_id: w.officer, at: ts(at, 15), physical_pct: p, expenditure_lakh: r2((w.expenditure * i) / steps),
          remark: i === steps ? (w.hold ?? 'Progress updated after site visit') : pick(['Site visit — work in progress', 'MB recorded for completed items', 'Material received at site', 'Progress as per contractor report, verified by JE']),
          source: i === steps && w.source?.startsWith('import') ? 'import' : 'manual',
        });
      }
      return id;
    };

    // Showcase works (stable story for the demo)
    addWork({
      key: 'RAUNIA_SCHOOL', dept: 'EDU', block: 'ALA', panchayat: 'Raunia', kind: 'building',
      name: 'Major repair of building & 3 classrooms, UMS Raunia', category: 'School building', scheme: 'State Plan (School Infrastructure)',
      sanctioned: 18.6, expenditure: 2.8, physical: 15, agency: 'M/s Shree Ram Enterprises', start: ago(170), target: ahead(25),
      status: 'stalled', officer: U.BEO_ALA,
      nextAction: 'Treasury to issue revised fund allotment (₹24.1 L) so roof slab work can resume', nextDue: ahead(5),
      hold: 'Revised estimate (₹18.6 L → ₹24.1 L) awaiting fund allotment — file EDN/ALA/2026/118 pending at District Treasury',
      publicApproved: false, publicSummary: null, updatedAgo: 31,
    });
    addWork({
      key: 'RAUNIA_WATER', dept: 'PHED', block: 'ALA', panchayat: 'Raunia', kind: 'water',
      name: 'Restoration of Nal Jal supply, Ward 7 Raunia (incl. UMS Raunia connection)', category: 'Water supply', scheme: 'Har Ghar Nal Jal',
      sanctioned: 9.4, expenditure: 3.1, physical: 35, agency: 'Ward Implementation & Management Committee, Ward 7', start: ago(62), target: ahead(14),
      status: 'in_progress', officer: U.JE_ALA,
      nextAction: 'Replace burnt 3 HP submersible pump and repair 140 m rising main', nextDue: ahead(3),
      hold: 'Pump purchase file PHED/ALA/2026/097 awaiting EE approval', publicApproved: true,
      publicSummary: 'Repair of the ward water supply is under way. Temporary supply by tanker on alternate days.', updatedAgo: 26,
    });
    addWork({
      key: 'MAHESHKHUNT_ROAD', dept: 'RWD', block: 'GOG', panchayat: 'Maheshkhunt', kind: 'road',
      name: 'MMGSY road: Maheshkhunt to Pasraha (5.8 km)', category: 'Rural road', scheme: 'MMGSY',
      sanctioned: 412.5, expenditure: 221.4, physical: 58, agency: 'M/s Kosi Infra Constructions', start: ago(520), target: ago(64),
      status: 'in_progress', officer: U.AE_GOG,
      nextAction: 'Circle Officer, Gogri to complete demarcation at Ch. 3.2 km so the contractor can re-mobilise', nextDue: ago(12),
      hold: 'Work held at Ch. 3.2 km — 0.42 acre land dispute; demarcation file REV/GOG/2026/061 pending with Circle Officer, Gogri',
      publicApproved: true, publicSummary: 'Road work in progress. Section near Pasraha (about 600 m) awaiting land demarcation.', updatedAgo: 19,
    });
    addWork({
      key: 'TILATHI_HWC', dept: 'HLT', block: 'BEL', panchayat: 'Tilathi', kind: 'building',
      name: 'Health & Wellness Centre building, Tilathi', category: 'Health building', scheme: 'NHM / 15th FC Health Grant',
      sanctioned: 68.0, expenditure: 66.2, physical: 100, agency: 'M/s Mithila Construction Co.', start: ago(480), target: ago(120),
      status: 'completed', officer: U.MOIC_BEL, nextAction: 'Building handed over — operationalise HWC (water connection, ANM posting)', nextDue: null,
      hold: null, publicApproved: true, publicSummary: 'Building completed and handed over to the Health Department.', updatedAgo: 44,
    });
    addWork({
      key: 'SORHA_PSB', dept: 'PRD', block: 'PAR', panchayat: 'Sorha', kind: 'building',
      name: 'Panchayat Sarkar Bhawan, Sorha', category: 'Panchayat building', scheme: 'Panchayat Sarkar Bhawan Yojana',
      sanctioned: 118.0, expenditure: 84.6, physical: 78, agency: 'M/s Bagmati Projects Pvt. Ltd.', start: ago(400), target: ahead(110),
      status: 'in_progress', officer: U.DPRO, nextAction: 'Complete plaster & flooring of first floor', nextDue: ahead(30),
      hold: null, publicApproved: true, publicSummary: 'Construction on schedule. First floor finishing in progress.', updatedAgo: 6,
    });
    addWork({
      key: 'SAHSI_AWC', dept: 'ICDS', block: 'ALA', panchayat: 'Sahsi', kind: 'building',
      name: 'Anganwadi Centre building, Sahsi (AWC 114)', category: 'AWC building', scheme: 'ICDS – MGNREGA convergence',
      sanctioned: 11.6, expenditure: 0, physical: 0, agency: 'Departmental (Vibhagiya)', start: ago(95), target: ahead(140),
      status: 'not_started', officer: U.CDPO_ALA, nextAction: 'Circle Officer, Alauli to issue land NOC for the 3-decimal plot', nextDue: ago(20),
      hold: 'Land NOC pending with Circle Officer, Alauli (file ICDS/ALA/2026/044)', publicApproved: false, publicSummary: null, updatedAgo: 47,
    });
    addWork({
      key: 'ROHIYAR_SCHOOL', dept: 'EDU', block: 'CHT', panchayat: 'Rohiyar', kind: 'building',
      name: 'Additional classrooms (4) at UMS Rohiyar', category: 'School building', scheme: 'Samagra Shiksha',
      sanctioned: 46.8, expenditure: 17.9, physical: 40, agency: 'M/s Anand Engicon', start: ago(330), target: ahead(20),
      status: 'in_progress', officer: U.SSA, nextAction: 'Contractor to deploy additional labour; show-cause reply due', nextDue: ago(3),
      hold: null, publicApproved: false, publicSummary: null, updatedAgo: 48,
    });
    addWork({
      key: 'MAHESHKHUNT_IRP', dept: 'PHED', block: 'GOG', panchayat: 'Maheshkhunt', kind: 'water',
      name: 'Iron removal plant, Maheshkhunt', category: 'Water supply', scheme: 'Jal Jeevan Mission (Iron removal)',
      sanctioned: 62.3, expenditure: 51.0, physical: 92, agency: 'M/s Ganga Builders, Begusarai', start: ago(290), target: ahead(18),
      status: 'in_progress', officer: U.JE_GOG, nextAction: 'Trial run and water test before handover', nextDue: ahead(10),
      hold: null, publicApproved: true, publicSummary: 'Plant nearly complete; trial run scheduled.', updatedAgo: 4,
    });

    // Generated works across every block and department
    const TEMPLATES: Record<string, { category: string; scheme: string; kind: keyof typeof MILESTONES; min: number; max: number; months: number; name: (v: string, v2: string) => string }[]> = {
      RWD: [
        { category: 'Rural road', scheme: 'MMGSY', kind: 'road', min: 140, max: 460, months: 18, name: (v, v2) => `MMGSY road: ${v} to ${v2} (${(1.8 + R() * 5).toFixed(1)} km)` },
        { category: 'Rural road', scheme: 'PMGSY-III', kind: 'road', min: 180, max: 520, months: 18, name: (v) => `PMGSY-III upgradation: ${v} – NH-31 link road` },
        { category: 'Bridge / culvert', scheme: 'MMSY (Bridge)', kind: 'building', min: 24, max: 95, months: 10, name: (v) => `RCC box culvert on ${v} chaur drain` },
      ],
      EDU: [
        { category: 'School building', scheme: 'Samagra Shiksha', kind: 'building', min: 30, max: 58, months: 12, name: (v) => `Additional classrooms (4) at UMS ${v}` },
        { category: 'School building', scheme: 'State Plan (School Infrastructure)', kind: 'building', min: 8, max: 22, months: 6, name: (v) => `Toilet block & boundary wall, MS ${v}` },
        { category: 'School building', scheme: 'PM SHRI', kind: 'building', min: 20, max: 45, months: 9, name: (v) => `Smart class, library & lab upgrade, +2 HS ${v}` },
      ],
      PHED: [
        { category: 'Water supply', scheme: 'Har Ghar Nal Jal', kind: 'water', min: 14, max: 48, months: 9, name: (v) => `Har Ghar Nal Jal, Ward ${randint(2, 14)}, ${v}` },
        { category: 'Water supply', scheme: 'Jal Jeevan Mission (Iron removal)', kind: 'water', min: 28, max: 75, months: 10, name: (v) => `Iron removal plant & distribution, ${v}` },
        { category: 'Water supply', scheme: 'Har Ghar Nal Jal (Retrofitting)', kind: 'water', min: 6, max: 18, months: 5, name: (v) => `Retrofitting of mini water supply scheme, ${v}` },
      ],
      HLT: [{ category: 'Health building', scheme: 'NHM / 15th FC Health Grant', kind: 'building', min: 55, max: 110, months: 14, name: (v) => `Health & Wellness Centre building, ${v}` }],
      PRD: [
        { category: 'Panchayat building', scheme: 'Panchayat Sarkar Bhawan Yojana', kind: 'building', min: 95, max: 130, months: 18, name: (v) => `Panchayat Sarkar Bhawan, ${v}` },
        { category: 'Street lighting', scheme: 'Mukhyamantri Gramin Solar Street Light', kind: 'light', min: 18, max: 32, months: 5, name: (v) => `Solar street lights (120 nos.), ${v} panchayat` },
      ],
      ICDS: [{ category: 'AWC building', scheme: 'ICDS – MGNREGA convergence', kind: 'building', min: 8, max: 12.5, months: 8, name: (v) => `Anganwadi Centre building, ${v} (AWC ${randint(20, 260)})` }],
      RDD: [{ category: 'Water conservation', scheme: 'Jal-Jeevan-Hariyali (MGNREGA)', kind: 'water', min: 6, max: 24, months: 6, name: (v) => `Pond renovation & ghat, ${v}` }],
    };
    const PER_BLOCK: [string, number][] = [['RWD', 3], ['EDU', 3], ['PHED', 3], ['HLT', 1], ['PRD', 2], ['ICDS', 2], ['RDD', 1]];
    const HOLDS: Record<string, string[]> = {
      RWD: ['Contractor slow; second notice issued', 'Bitumen rates revised — awaiting decision on price variation', 'Waterlogging after flood season; work resumes post-drainage'],
      EDU: ['Contractor absconding; termination proposal under process', 'School premises dispute with adjoining raiyat', 'Revised estimate awaiting technical sanction'],
      PHED: ['Electric connection awaited from NBPDCL', 'Pipeline route blocked — road cutting permission awaited', 'Ward committee account frozen pending audit'],
      HLT: ['Design change requested by department; drawings awaited'],
      PRD: ['Second instalment awaited from department', 'Land transfer to panchayat pending'],
      ICDS: ['Land NOC pending with Circle Office', 'MGNREGA material component funds exhausted'],
      RDD: ['Encroachment on pond bank; removal pending'],
    };
    for (const b of BLOCKS) {
      const vs = b.villages;
      for (const [dept, count] of PER_BLOCK) {
        for (let i = 0; i < count; i++) {
          const t = pick(TEMPLATES[dept]);
          const v = pick(vs);
          const v2 = pick(vs.filter((x) => x !== v));
          const sanctioned = r1(rand(t.min, t.max));
          const duration = Math.round(t.months * 30 * rand(0.85, 1.15));
          const roll = R();
          let status: WorkSpec['status'];
          let start: string;
          let physical: number;
          let updatedAgo: number;
          let hold: string | null = null;
          let nextAction: string | null;
          if (roll < 0.22) {
            status = 'completed';
            start = ago(randint(duration + 30, duration + 360));
            physical = 100;
            updatedAgo = randint(20, 120);
            nextAction = 'Completion certificate issued; defect liability period running';
          } else if (roll < 0.7) {
            status = 'in_progress';
            const el = randint(40, Math.max(60, duration - 20));
            start = ago(el);
            physical = Math.min(97, Math.max(5, (el / duration) * 100 * rand(0.88, 1.1)));
            updatedAgo = randint(2, 22);
            nextAction = pick(['Next RA bill after measurement', 'Complete current milestone and update MB', 'JE to verify quality of material at site', 'Submit utilisation certificate for released instalment']);
          } else if (roll < 0.88) {
            status = 'in_progress'; // delayed
            const el = randint(Math.round(duration * 0.7), duration + 160);
            start = ago(el);
            const expected = Math.min(100, (el / duration) * 100);
            physical = Math.max(8, expected - rand(22, 48));
            updatedAgo = randint(12, 65);
            hold = chance(0.5) ? pick(HOLDS[dept]) : null;
            nextAction = hold ? `Resolve: ${hold.toLowerCase()}` : 'Issue notice to agency and submit recovery plan with weekly milestones';
          } else if (roll < 0.95) {
            status = 'stalled';
            const el = randint(Math.round(duration * 0.5), duration + 120);
            start = ago(el);
            physical = rand(10, 62);
            updatedAgo = randint(35, 95);
            hold = pick(HOLDS[dept]);
            nextAction = `Resolve hold: ${hold}`;
          } else {
            status = 'not_started';
            start = chance(0.5) ? ahead(randint(5, 40)) : ago(randint(10, 70));
            physical = 0;
            updatedAgo = randint(5, 50);
            nextAction = pick(['Issue work order after tender finalisation', 'Hand over site to agency', 'Obtain technical sanction']);
          }
          physical = status === 'completed' ? 100 : r1(physical);
          const target = addDays(start, duration);
          const expenditure = status === 'completed' ? r2(sanctioned * rand(0.9, 0.995)) : r2(sanctioned * (physical / 100) * rand(0.7, 1.0));
          const publicApproved = status === 'completed' ? chance(0.85) : status === 'in_progress' ? chance(0.55) : false;
          addWork({
            dept, block: b.code, panchayat: v, name: t.name(v, v2), category: t.category, scheme: t.scheme, kind: t.kind,
            sanctioned, expenditure, physical, agency: dept === 'PHED' && t.scheme === 'Har Ghar Nal Jal' ? `Ward Implementation & Management Committee, ${v}` : pick(AGENCIES),
            start, target, status, officer: responsible(dept, b.code), nextAction,
            nextDue: status === 'completed' ? null : addDays(today, randint(-20, 30)), hold,
            publicApproved, publicSummary: publicApproved ? (status === 'completed' ? 'Work completed and in use.' : 'Work in progress as per schedule reported by the department.') : null,
            updatedAgo,
          });
        }
      }
    }

    // ---------- assets, inspections, findings, evidence ----------
    const assetId: Record<string, number> = {};
    let assetSeq = 1;
    const CYCLE: Record<string, number> = { school: 90, awc: 60, hsc: 60, phc: 60, handpump: 30, water_scheme: 30, panchayat_bhawan: 180 };
    const ASSET_DEPT: Record<string, string> = { school: 'EDU', awc: 'ICDS', hsc: 'HLT', phc: 'HLT', handpump: 'PHED', water_scheme: 'PHED', panchayat_bhawan: 'PRD' };
    interface AssetSpec {
      key?: string; type: string; block: string; village: string; name: string; condition: 'good' | 'needs_repair' | 'critical';
      functional: 'functional' | 'partially' | 'non_functional'; lastInspectedAgo: number; details: Record<string, unknown>; officer?: number; isPublic?: boolean;
    }
    const addAsset = (a: AssetSpec) => {
      const dept = ASSET_DEPT[a.type];
      const cycle = CYCLE[a.type];
      const last = ago(a.lastInspectedAgo);
      const id = insert(db, 'assets', {
        code: `${dept}-${a.block}-${a.type.toUpperCase().slice(0, 3)}-${String(assetSeq++).padStart(4, '0')}`,
        name: a.name, type: a.type, department_id: D[dept], block_id: B[a.block], panchayat: a.village, village: a.village,
        officer_id: a.officer ?? responsible(dept, a.block), condition: a.condition, functional_status: a.functional,
        inspection_cycle_days: cycle, last_inspected: last, next_inspection_due: addDays(last, cycle), public: a.isPublic === false ? 0 : 1,
        details: JSON.stringify(a.details), lat: r2(25.35 + R() * 0.35) , lng: r2(86.3 + R() * 0.55), updated_at: ts(last, 16),
      });
      if (a.key) assetId[a.key] = id;
      return id;
    };
    const addInspection = (asset: number, conducted: string | null, scheduled: string, inspector: number, condition: string | null, remarks: string | null, status = conducted ? 'completed' : 'scheduled') =>
      insert(db, 'inspections', { asset_id: asset, scheduled_date: scheduled, conducted_date: conducted, inspector_id: inspector, status, condition_found: condition, remarks, created_at: ts(addDays(scheduled, -7)) });
    const findingId: Record<string, number> = {};
    interface FindingSpec {
      key?: string; asset: number; inspection: number | null; title: string; description: string; category: string; severity: string;
      status: string; dept: string; assignedTo: number | null; assignedBy: number | null; due: string | null; createdAgo: number; reopen?: number;
    }
    const addFinding = (f: FindingSpec) => {
      const id = insert(db, 'findings', {
        asset_id: f.asset, inspection_id: f.inspection, title: f.title, description: f.description, category: f.category, severity: f.severity,
        status: f.status, responsible_department_id: D[f.dept], assigned_to: f.assignedTo, assigned_by: f.assignedBy, due_date: f.due,
        reopen_count: f.reopen ?? 0, created_at: ts(ago(f.createdAgo), 12), updated_at: ts(ago(Math.max(0, f.createdAgo - randint(1, 8))), 13),
        closed_at: f.status === 'closed' ? ts(ago(Math.max(0, f.createdAgo - randint(8, 20))), 17) : null,
        closed_by: f.status === 'closed' ? (f.assignedBy ?? U.DDC) : null,
      });
      if (f.key) findingId[f.key] = id;
      return id;
    };
    const addEvidence = (entity: 'finding' | 'action' | 'work', entityId: number, fileName: string, title: string, place: string, uploadedBy: number, uploadedAgo: number, review: 'pending' | 'accepted' | 'rejected', reviewer: number | null, remark: string | null, note: string) => {
      const dataUrl = svgEvidence(title, place, `uploaded ${ago(uploadedAgo)}`);
      insert(db, 'evidence', {
        entity_type: entity, entity_id: entityId, file_name: fileName, mime: 'image/svg+xml', size: dataUrl.length, data_url: dataUrl,
        sha256: null, note, uploaded_by: uploadedBy, uploaded_at: ts(ago(uploadedAgo), 15),
        review_status: review, reviewed_by: review === 'pending' ? null : reviewer, reviewed_at: review === 'pending' ? null : ts(ago(Math.max(0, uploadedAgo - 2)), 12), review_remark: remark,
      });
    };

    // Showcase assets & findings
    const raunia = addAsset({ key: 'RAUNIA_SCHOOL', type: 'school', block: 'ALA', village: 'Raunia', name: 'Utkramit Madhya Vidyalaya (UMS) Raunia', condition: 'critical', functional: 'partially', lastInspectedAgo: 34, details: { enrolment: 412, classrooms: 6, teachers: 9, mdm: 'Yes' } });
    const rauniaHp = addAsset({ key: 'RAUNIA_HP', type: 'handpump', block: 'ALA', village: 'Raunia', name: 'India Mark-III handpump, UMS Raunia campus', condition: 'critical', functional: 'non_functional', lastInspectedAgo: 21, details: { depth_ft: 160, households_served: 0, users: 'School (412 students)' } });
    const rauniaNj = addAsset({ key: 'RAUNIA_NJ', type: 'water_scheme', block: 'ALA', village: 'Raunia', name: 'Nal Jal scheme, Ward 7 Raunia', condition: 'critical', functional: 'non_functional', lastInspectedAgo: 24, details: { households: 64, pump_hp: 3, tank_kl: 10 } });
    const tilathi = addAsset({ key: 'TILATHI_HWC', type: 'hsc', block: 'BEL', village: 'Tilathi', name: 'Health & Wellness Centre, Tilathi', condition: 'needs_repair', functional: 'partially', lastInspectedAgo: 40, details: { population_served: 8200, anm_posted: 0, delivery_point: 'Not yet' } });
    const sahsi = addAsset({ key: 'SAHSI_AWC', type: 'awc', block: 'ALA', village: 'Sahsi', name: 'Anganwadi Centre 114, Sahsi (rented room)', condition: 'critical', functional: 'partially', lastInspectedAgo: 28, details: { children_3_6: 38, pregnant_lactating: 22, building: 'Rented' } });

    const insRaunia = addInspection(raunia, ago(34), ago(36), U.BEO_ALA, 'critical', 'Roof slab cracks in 3 classrooms; classes shifted to verandah. Handpump on campus non-functional.');
    addInspection(raunia, ago(120), ago(122), U.BEO_ALA, 'needs_repair', 'Seepage in roof; repair estimate prepared.');
    addInspection(raunia, null, ahead(20), U.DEO, null, null);
    const insHp = addInspection(rauniaHp, ago(21), ago(21), U.JE_ALA, 'critical', 'Handpump chain & riser pipe failed. FTK iron 1.8 mg/L (limit 1.0).');
    const insNj = addInspection(rauniaNj, ago(24), ago(25), U.JE_ALA, 'critical', 'Submersible pump burnt; supply off for 64 households. Tanker supply arranged.');
    const insTil = addInspection(tilathi, ago(40), ago(41), U.MOIC_BEL, 'needs_repair', 'New building handed over; no piped water; ANM not posted, deliveries referred to PHC.');
    const insSahsi = addInspection(sahsi, ago(28), ago(30), U.CDPO_ALA, 'critical', 'Centre in single rented room without toilet or drinking water.');

    addFinding({ key: 'RAUNIA_ROOF', asset: raunia, inspection: insRaunia, title: 'Roof slab of 3 classrooms cracked — classes shifted to verandah', description: 'Visible cracks with seepage in rooms 2–4. Unsafe for students. Repair covered by work EDU/ALA (UMS Raunia repair).', category: 'Structure', severity: 'critical', status: 'assigned', dept: 'EDU', assignedTo: U.BEO_ALA, assignedBy: U.DEO, due: ago(6), createdAgo: 34 });
    addFinding({ key: 'RAUNIA_HP', asset: rauniaHp, inspection: insHp, title: 'Handpump non-functional; FTK shows iron 1.8 mg/L (limit 1.0)', description: 'Only drinking-water source on the school campus. Students carry water from home.', category: 'Drinking water', severity: 'critical', status: 'assigned', dept: 'PHED', assignedTo: U.JE_ALA, assignedBy: U.EEPHED, due: ahead(3), createdAgo: 21 });
    addFinding({ key: 'RAUNIA_NJ', asset: rauniaNj, inspection: insNj, title: 'Pump burnt — supply off for 64 households in Ward 7', description: 'Tanker supply on alternate days. Pump purchase file pending with EE PHED.', category: 'Drinking water', severity: 'critical', status: 'assigned', dept: 'PHED', assignedTo: U.JE_ALA, assignedBy: U.EEPHED, due: ago(2), createdAgo: 24 });
    const fTilWater = addFinding({ key: 'TILATHI_WATER', asset: tilathi, inspection: insTil, title: 'Piped water not connected to the new HWC building', description: 'Labour room cannot be operationalised without running water.', category: 'Drinking water', severity: 'high', status: 'resolution_submitted', dept: 'PHED', assignedTo: U.EEPHED, assignedBy: U.CS, due: ago(5), createdAgo: 40 });
    addEvidence('finding', fTilWater, 'tilathi_hwc_water_connection.svg', 'HWC Tilathi — water connection completed', 'Tilathi, Beldaur', U.EEPHED, 3, 'pending', null, null, 'Connection laid from Ward 3 Nal Jal line; tap working in labour room and OPD.');
    addFinding({ key: 'TILATHI_ANM', asset: tilathi, inspection: insTil, title: 'ANM post vacant since July — deliveries referred to PHC', description: 'Building ready but no ANM posted; delivery point cannot start.', category: 'Staffing', severity: 'high', status: 'open', dept: 'HLT', assignedTo: null, assignedBy: null, due: null, createdAgo: 40 });
    addFinding({ key: 'SAHSI_ROOM', asset: sahsi, inspection: insSahsi, title: 'AWC running in a rented single room — no toilet or drinking water', description: '38 children and 22 mothers served from a 10×12 ft room. New building blocked by land NOC.', category: 'Structure', severity: 'high', status: 'assigned', dept: 'ICDS', assignedTo: U.CDPO_ALA, assignedBy: U.DPOICDS, due: ahead(30), createdAgo: 28 });

    // Generated assets per block
    const FINDING_LIB: Record<string, { title: string; category: string; sev: string[] }[]> = {
      school: [
        { title: 'Roof leakage in classrooms', category: 'Structure', sev: ['high', 'medium'] },
        { title: 'Toilet block non-functional (no running water)', category: 'Sanitation', sev: ['high'] },
        { title: 'Boundary wall partly collapsed', category: 'Structure', sev: ['medium'] },
        { title: 'Exposed electrical wiring in classroom', category: 'Electrical', sev: ['critical', 'high'] },
        { title: 'MDM kitchen shed damaged', category: 'Structure', sev: ['medium'] },
      ],
      awc: [
        { title: 'Cracks in roof and walls', category: 'Structure', sev: ['critical', 'high'] },
        { title: 'No drinking-water source at centre', category: 'Drinking water', sev: ['high'] },
        { title: 'Growth-monitoring weighing scale missing', category: 'Equipment', sev: ['low', 'medium'] },
        { title: 'Toilet unusable', category: 'Sanitation', sev: ['medium'] },
      ],
      hsc: [
        { title: 'Labour room equipment non-functional', category: 'Equipment', sev: ['high'] },
        { title: 'Approach road waterlogged', category: 'Access', sev: ['medium'] },
        { title: 'Essential drugs stock-out (5 items)', category: 'Supplies', sev: ['high', 'medium'] },
      ],
      phc: [
        { title: 'Generator out of order — power backup unavailable', category: 'Electrical', sev: ['high'] },
        { title: 'Ambulance (102) off-road for repairs', category: 'Equipment', sev: ['high', 'medium'] },
      ],
      handpump: [
        { title: 'Handpump non-functional (chain / riser pipe failure)', category: 'Drinking water', sev: ['critical', 'high'] },
        { title: 'Iron above permissible limit in FTK test', category: 'Water quality', sev: ['high'] },
        { title: 'Platform broken; stagnant water around handpump', category: 'Sanitation', sev: ['medium'] },
      ],
      water_scheme: [
        { title: 'Pipeline leakage in distribution network', category: 'Drinking water', sev: ['medium', 'high'] },
        { title: 'Pump operator unpaid; supply irregular', category: 'O&M', sev: ['medium'] },
        { title: 'Supply off — motor burnt', category: 'Drinking water', sev: ['critical'] },
      ],
      panchayat_bhawan: [
        { title: 'RTPS counter not functional', category: 'Service delivery', sev: ['medium'] },
        { title: 'Solar power system faulty', category: 'Electrical', sev: ['low', 'medium'] },
      ],
    };
    const ASSET_MIX: [string, number, (v: string, n: number, blk: string) => string, () => Record<string, unknown>][] = [
      ['school', 4, (v, n) => [`UMS ${v}`, `Kanya Madhya Vidyalaya, ${v}`, `Prathmik Vidyalaya, ${v} Tola`, `+2 High School, ${v}`][n % 4], () => ({ enrolment: randint(140, 780), classrooms: randint(4, 14), teachers: randint(4, 22), mdm: 'Yes' })],
      ['awc', 4, (v) => `Anganwadi Centre ${randint(10, 280)}, ${v}`, () => ({ children_3_6: randint(18, 46), pregnant_lactating: randint(8, 30), building: pick(['Own', 'Own', 'School premises', 'Rented']) })],
      ['hsc', 2, (v) => `Health & Wellness Centre, ${v}`, () => ({ population_served: randint(4000, 9000), anm_posted: randint(0, 2) })],
      ['phc', 1, (_v, _n, blk) => `Primary Health Centre, ${blk}`, () => ({ beds: randint(6, 30), doctors_posted: randint(2, 6) })],
      ['handpump', 4, (v) => `India Mark-III handpump, ${v} Ward ${randint(1, 14)}`, () => ({ depth_ft: randint(120, 220), households_served: randint(15, 60) })],
      ['water_scheme', 3, (v) => `Nal Jal scheme, Ward ${randint(1, 14)} ${v}`, () => ({ households: randint(40, 140), pump_hp: pick([2, 3, 5]), tank_kl: pick([5, 10, 15]) })],
      ['panchayat_bhawan', 2, (v) => `Panchayat Sarkar Bhawan, ${v}`, () => ({ rtps_counter: pick(['Yes', 'Yes', 'No']), staff_posted: randint(2, 6) })],
    ];
    for (const b of BLOCKS) {
      for (const [type, count, nameFn, detailsFn] of ASSET_MIX) {
        for (let n = 0; n < count; n++) {
          const v = b.villages[(n + randint(0, 5)) % b.villages.length];
          const roll = R();
          const condition: AssetSpec['condition'] = roll < 0.62 ? 'good' : roll < 0.89 ? 'needs_repair' : 'critical';
          const functional: AssetSpec['functional'] = condition === 'good' ? 'functional' : condition === 'needs_repair' ? (chance(0.6) ? 'functional' : 'partially') : chance(0.6) ? 'non_functional' : 'partially';
          const cycle = CYCLE[type];
          const lastAgo = randint(3, Math.round(cycle * 1.6));
          const id = addAsset({ type, block: b.code, village: v, name: nameFn(v, n, b.name), condition, functional, lastInspectedAgo: lastAgo, details: detailsFn() });
          const dept = ASSET_DEPT[type];
          const inspector = responsible(dept, b.code) ?? U[`BDO_${b.code}`];
          const ins = addInspection(id, ago(lastAgo), ago(lastAgo + randint(0, 3)), inspector, condition, condition === 'good' ? 'No major issue observed.' : 'Issues recorded; see findings.');
          addInspection(id, ago(lastAgo + cycle + randint(0, 20)), ago(lastAgo + cycle + randint(0, 20)), inspector, chance(0.7) ? 'good' : 'needs_repair', 'Routine inspection.');
          const due = addDays(ago(lastAgo), cycle);
          if (chance(0.45)) addInspection(id, null, due, inspector, null, null);
          // findings
          const lib = FINDING_LIB[type];
          const nFind = condition === 'good' ? (chance(0.12) ? 1 : 0) : condition === 'needs_repair' ? 1 : randint(1, 2);
          for (let k = 0; k < nFind; k++) {
            const tpl = lib[(k + randint(0, lib.length - 1)) % lib.length];
            let severity = pick(tpl.sev);
            if (condition === 'critical' && k === 0 && severity !== 'critical') severity = chance(0.6) ? 'critical' : 'high';
            const sRoll = R();
            const status = condition === 'good' ? 'closed' : sRoll < 0.25 ? 'open' : sRoll < 0.66 ? 'assigned' : sRoll < 0.8 ? 'resolution_submitted' : 'closed';
            const head = districtHead[dept];
            const assignee = status === 'open' ? null : responsible(dept, b.code);
            const fid = addFinding({
              asset: id, inspection: ins, title: tpl.title, description: `${tpl.title} at ${nameFn(v, n, b.name)}. Recorded during inspection on ${ago(lastAgo)}.`,
              category: tpl.category, severity, status, dept, assignedTo: assignee, assignedBy: status === 'open' ? null : head,
              due: status === 'open' ? null : addDays(ago(lastAgo), randint(10, 45)), createdAgo: lastAgo, reopen: status === 'assigned' && chance(0.12) ? 1 : 0,
            });
            if (status === 'resolution_submitted' || status === 'closed') {
              addEvidence('finding', fid, `${type}_${id}_resolution.svg`, `${tpl.title} — rectified`, `${v}, ${b.name}`, assignee ?? head, randint(1, Math.max(2, lastAgo - 2)),
                status === 'closed' ? 'accepted' : 'pending', status === 'closed' ? head : null, status === 'closed' ? 'Verified with geo-tagged photo and site report.' : null,
                'Rectification completed; photo and measurement attached.');
            }
          }
        }
      }
    }

    // ---------- files & movements ----------
    const fileId: Record<string, number> = {};
    interface Move { daysAgo: number; action: string; from: number | null; to: number | null; by: number; toUser?: number | null; remark: string }
    interface FileSpec {
      key?: string; no: string; subject: string; category: string; dept: string; block: string | null; status: string; priority: string;
      decision: string; sla: number; amount: number | null; work: number | null; asset: number | null; moves: Move[]; createdBy: number;
    }
    const addFile = (f: FileSpec) => {
      const last = f.moves[f.moves.length - 1];
      const current = last.to ?? last.from!;
      const holder = last.toUser ?? holderOfOffice(current);
      const id = insert(db, 'files', {
        file_no: f.no, subject: f.subject, category: f.category, department_id: D[f.dept], block_id: f.block ? B[f.block] : null,
        current_office_id: current, current_holder_id: holder, status: f.status, priority: f.priority, decision_required: f.decision,
        sla_days: f.sla, amount_lakh: f.amount, work_id: f.work, asset_id: f.asset, opened_at: ts(ago(f.moves[0].daysAgo), 10),
        arrived_at: ts(ago(last.daysAgo), 12), closed_at: f.status === 'closed' ? ts(ago(last.daysAgo), 16) : null, created_by: f.createdBy,
      });
      for (const m of f.moves) {
        insert(db, 'file_movements', { file_id: id, at: ts(ago(m.daysAgo), randint(10, 17), randint(0, 59)), action: m.action, from_office_id: m.from, to_office_id: m.to, by_user_id: m.by, to_user_id: m.toUser ?? (m.to ? holderOfOffice(m.to) : null), remark: m.remark });
        audit(ts(ago(m.daysAgo), 17), m.by, `file.${m.action}`, 'file', id, `${f.no}: ${m.action}${m.to ? ' → ' + (db.get<{ name: string }>('SELECT name FROM offices WHERE id = ?', [m.to])?.name ?? '') : ''}`);
      }
      if (f.key) fileId[f.key] = id;
      return id;
    };

    addFile({
      key: 'RAUNIA_FUND', no: 'EDN/ALA/2026/118', subject: 'Revised estimate & fund allotment — repair of UMS Raunia (₹24.1 lakh)', category: 'Fund allotment',
      dept: 'EDU', block: 'ALA', status: 'open', priority: 'high', sla: 10, amount: 24.1, work: workId.RAUNIA_SCHOOL, asset: raunia, createdBy: U.BEO_ALA,
      decision: 'District Treasury to confirm budget head availability (2202-01) and issue allotment advice; DDC to accord revised administrative approval.',
      moves: [
        { daysAgo: 71, action: 'created', from: office.BLK_ALA, to: office.BLK_ALA, by: U.BEO_ALA, remark: 'Revised estimate prepared after roof slab cracks found.' },
        { daysAgo: 66, action: 'forwarded', from: office.BLK_ALA, to: office.SSA, by: U.BEO_ALA, remark: 'Forwarded for technical vetting and approval.' },
        { daysAgo: 60, action: 'query', from: office.SSA, to: office.BLK_ALA, by: U.SSA, toUser: U.BEO_ALA, remark: 'Attach revised estimate vetted by JE with site photographs.' },
        { daysAgo: 52, action: 'replied', from: office.BLK_ALA, to: office.SSA, by: U.BEO_ALA, remark: 'Vetted estimate and photographs attached.' },
        { daysAgo: 47, action: 'forwarded', from: office.SSA, to: office.DDC, by: U.SSA, remark: 'Recommended for revised AA of ₹24.1 lakh.' },
        { daysAgo: 38, action: 'forwarded', from: office.DDC, to: office.TRE, by: U.DDC, remark: 'For budget availability and allotment advice.' },
      ],
    });
    addFile({
      key: 'GOG_LAND', no: 'REV/GOG/2026/061', subject: 'Demarcation of 0.42 acre at Ch. 3.2 km — MMGSY road Maheshkhunt–Pasraha', category: 'Land / NOC',
      dept: 'REV', block: 'GOG', status: 'open', priority: 'high', sla: 21, amount: null, work: workId.MAHESHKHUNT_ROAD, asset: null, createdBy: U.AE_GOG,
      decision: 'Circle Officer, Gogri to complete demarcation (Amin report) and pass order on the raiyat objection; ADM (Revenue) to monitor.',
      moves: [
        { daysAgo: 96, action: 'created', from: office.RWD, to: office.RWD, by: U.EERWD, remark: 'Contractor stopped at Ch. 3.2 km due to objection by raiyat.' },
        { daysAgo: 90, action: 'forwarded', from: office.RWD, to: office.ADMR, by: U.EERWD, remark: 'Request demarcation of road land.' },
        { daysAgo: 77, action: 'forwarded', from: office.ADMR, to: office.CO_GOG, by: U.ADMR, remark: 'CO to demarcate and report within 15 days.' },
        { daysAgo: 64, action: 'query', from: office.CO_GOG, to: office.RWD, by: U.CO_GOG, toUser: U.EERWD, remark: 'Provide alignment drawing with khesra numbers.' },
        { daysAgo: 55, action: 'replied', from: office.RWD, to: office.CO_GOG, by: U.EERWD, remark: 'Alignment drawing with khesra numbers attached.' },
      ],
    });
    addFile({
      key: 'SAHSI_NOC', no: 'ICDS/ALA/2026/044', subject: 'Land NOC for AWC 114 building, Sahsi (3 decimal, Khata 212)', category: 'Land / NOC',
      dept: 'ICDS', block: 'ALA', status: 'open', priority: 'normal', sla: 30, amount: null, work: workId.SAHSI_AWC, asset: sahsi, createdBy: U.CDPO_ALA,
      decision: 'Circle Officer, Alauli to verify government land and issue NOC for transfer to ICDS.',
      moves: [
        { daysAgo: 88, action: 'created', from: office.BLK_ALA, to: office.BLK_ALA, by: U.CDPO_ALA, remark: 'Land identified by panchayat; NOC requested.' },
        { daysAgo: 84, action: 'forwarded', from: office.BLK_ALA, to: office.CO_ALA, by: U.CDPO_ALA, remark: 'For land verification and NOC.' },
        { daysAgo: 70, action: 'query', from: office.CO_ALA, to: office.BLK_ALA, by: U.CO_ALA, toUser: U.CDPO_ALA, remark: 'Panchayat resolution copy required.' },
        { daysAgo: 49, action: 'replied', from: office.BLK_ALA, to: office.CO_ALA, by: U.CDPO_ALA, remark: 'Resolution of Gram Sabha attached.' },
      ],
    });
    addFile({
      key: 'TILATHI_ANM', no: 'HLT/EST/2026/233', subject: 'Posting of ANM at Health & Wellness Centre, Tilathi', category: 'Establishment',
      dept: 'HLT', block: 'BEL', status: 'open', priority: 'high', sla: 15, amount: null, work: null, asset: tilathi, createdBy: U.MOIC_BEL,
      decision: 'Civil Surgeon to issue posting / deputation order for one ANM to HWC Tilathi.',
      moves: [
        { daysAgo: 33, action: 'created', from: office.BLK_BEL, to: office.BLK_BEL, by: U.MOIC_BEL, remark: 'HWC building ready; ANM required to start deliveries.' },
        { daysAgo: 26, action: 'forwarded', from: office.BLK_BEL, to: office.CS, by: U.MOIC_BEL, remark: 'Proposal with duty roster.' },
      ],
    });
    addFile({
      key: 'RAUNIA_PUMP', no: 'PHED/ALA/2026/097', subject: 'Emergency purchase of 3 HP submersible pump — Nal Jal Ward 7 Raunia (₹0.84 lakh)', category: 'Administrative approval',
      dept: 'PHED', block: 'ALA', status: 'open', priority: 'urgent', sla: 7, amount: 0.84, work: workId.RAUNIA_WATER, asset: rauniaNj, createdBy: U.JE_ALA,
      decision: 'EE PHED to approve emergency purchase under O&M head.',
      moves: [
        { daysAgo: 16, action: 'created', from: office.BLK_ALA, to: office.BLK_ALA, by: U.JE_ALA, remark: 'Pump burnt; quotation from 3 vendors attached.' },
        { daysAgo: 12, action: 'forwarded', from: office.BLK_ALA, to: office.PHED, by: U.JE_ALA, remark: 'Urgent — 64 households and school without water.' },
      ],
    });
    addFile({
      key: 'GOG_BILL', no: 'RWD/GOG/2026/188', subject: '3rd RA bill — MMGSY road Maheshkhunt–Pasraha (₹46.2 lakh)', category: 'Payment / bill',
      dept: 'RWD', block: 'GOG', status: 'open', priority: 'normal', sla: 7, amount: 46.2, work: workId.MAHESHKHUNT_ROAD, asset: null, createdBy: U.AE_GOG,
      decision: 'Treasury to pass the bill after MB check and deductions.',
      moves: [
        { daysAgo: 21, action: 'created', from: office.RWD, to: office.RWD, by: U.AE_GOG, remark: 'RA bill with MB pages 41–58.' },
        { daysAgo: 15, action: 'forwarded', from: office.RWD, to: office.DDC, by: U.EERWD, remark: 'For countersignature.' },
        { daysAgo: 9, action: 'forwarded', from: office.DDC, to: office.TRE, by: U.DDC, remark: 'For payment.' },
      ],
    });

    const FILE_CATS = [
      { cat: 'Administrative approval', sla: 15, decision: 'Accord administrative approval for the estimate.', subj: (w: string) => `Administrative approval — ${w}` },
      { cat: 'Technical sanction', sla: 15, decision: 'Accord technical sanction after vetting of estimate.', subj: (w: string) => `Technical sanction — ${w}` },
      { cat: 'Fund allotment', sla: 10, decision: 'Issue fund allotment / sub-allotment for the next instalment.', subj: (w: string) => `Allotment of 2nd instalment — ${w}` },
      { cat: 'Payment / bill', sla: 7, decision: 'Pass the RA bill after measurement-book check.', subj: (w: string) => `RA bill for payment — ${w}` },
      { cat: 'Tender approval', sla: 21, decision: 'Approve tender evaluation and issue work order.', subj: (w: string) => `Tender evaluation report — ${w}` },
      { cat: 'Utilisation certificate', sla: 10, decision: 'Verify and forward utilisation certificate to department.', subj: (w: string) => `Utilisation certificate — ${w}` },
    ];
    const worksForFiles = db.all<{ id: number; name: string; department_id: number; block_id: number; status: string; sanctioned_lakh: number }>(
      "SELECT id, name, department_id, block_id, status, sanctioned_lakh FROM works WHERE status != 'completed' ORDER BY id",
    );
    const deptCodeOf = (id: number) => DEPARTMENTS.find((d) => D[d.code] === id)!.code;
    let fseq = 300;
    for (const w of worksForFiles) {
      if (!chance(0.62)) continue;
      const dept = deptCodeOf(w.department_id);
      const blk = blockCodeOf(w.block_id);
      const c = pick(FILE_CATS);
      const origin = office[`BLK_${blk}`];
      const deptOff = deptOffice[dept];
      // route: block -> dept office -> (DDC) -> (Treasury for money)
      const route = [origin, deptOff];
      if (c.cat !== 'Technical sanction' && chance(0.6)) route.push(office.DDC);
      if ((c.cat === 'Payment / bill' || c.cat === 'Fund allotment') && chance(0.75)) route.push(office.TRE);
      const stops = randint(2, route.length);
      const totalAge = randint(8, 110);
      const atDesk = Math.min(totalAge - 2, Math.round(c.sla * rand(0.2, 3.2)));
      const moves: Move[] = [{ daysAgo: totalAge, action: 'created', from: origin, to: origin, by: responsible(dept, blk) ?? U[`BDO_${blk}`], remark: 'File opened.' }];
      for (let s = 1; s < stops; s++) {
        const daysAgo = s === stops - 1 ? atDesk : Math.round(totalAge - ((totalAge - atDesk) * s) / (stops - 1));
        const by = holderOfOffice(route[s - 1]) ?? U.DDC;
        moves.push({ daysAgo: Math.max(daysAgo, 1), action: 'forwarded', from: route[s - 1], to: route[s], by, remark: pick(['Forwarded for necessary action.', 'Recommended.', 'Put up for approval.', 'For perusal and orders.']) });
      }
      const sRoll = R();
      let status = 'open';
      if (sRoll < 0.12 && moves.length > 1) {
        const lastTo = moves[moves.length - 1].to!;
        moves.push({ daysAgo: Math.max(1, atDesk - randint(1, 3)), action: 'query', from: lastTo, to: origin, by: holderOfOffice(lastTo) ?? U.DDC, remark: pick(['Clarify deviation from approved estimate.', 'Attach site inspection report.', 'Budget head mismatch — please verify.']) });
        status = 'query';
      } else if (sRoll < 0.27) {
        const lastTo = moves[moves.length - 1].to!;
        moves.push({ daysAgo: Math.max(0, atDesk - randint(1, 4)), action: 'closed', from: lastTo, to: lastTo, by: holderOfOffice(lastTo) ?? U.DDC, remark: 'Approved and disposed.' });
        status = 'closed';
      }
      addFile({
        no: `${dept === 'EDU' ? 'EDN' : dept}/${blk}/2026/${String(fseq++).padStart(3, '0')}`,
        subject: c.subj(w.name), category: c.cat, dept, block: blk, status, priority: chance(0.15) ? 'high' : 'normal',
        decision: c.decision, sla: c.sla, amount: c.cat === 'Payment / bill' || c.cat === 'Fund allotment' ? r1(w.sanctioned_lakh * rand(0.15, 0.4)) : null,
        work: w.id, asset: null, moves, createdBy: moves[0].by,
      });
    }

    // ---------- cross-department initiatives (dependency model) ----------
    const addInit = (code: string, title: string, outcome: string, block: string, asset: number | null, target: string, links: { key: string; label: string; dept: string; type: string; ref: number; dependsOn?: string }[]) => {
      const iid = insert(db, 'initiatives', { code, title, outcome, block_id: B[block], asset_id: asset, coordinator_id: U.DDC, target_date: target, created_at: ts(ago(60)) });
      const linkIds: Record<string, number> = {};
      for (const l of links) linkIds[l.key] = insert(db, 'initiative_links', { initiative_id: iid, label: l.label, department_id: D[l.dept], ref_type: l.type, ref_id: l.ref, depends_on_link_id: null });
      for (const l of links) if (l.dependsOn) db.run('UPDATE initiative_links SET depends_on_link_id = ? WHERE id = ?', [linkIds[l.dependsOn], linkIds[l.key]]);
      return iid;
    };
    addInit('INIT-ALA-01', 'Middle School Improvement — UMS Raunia, Alauli', 'Safe classrooms and safe drinking water for 412 students before the 2027 annual examinations', 'ALA', raunia, ahead(60), [
      { key: 'fund', label: 'Revised fund allotment (District Treasury / DDC)', dept: 'FIN', type: 'file', ref: fileId.RAUNIA_FUND },
      { key: 'repair', label: 'Building & classroom repair (Education)', dept: 'EDU', type: 'work', ref: workId.RAUNIA_SCHOOL, dependsOn: 'fund' },
      { key: 'roof', label: 'Roof-slab safety finding closed with evidence', dept: 'EDU', type: 'finding', ref: findingId.RAUNIA_ROOF, dependsOn: 'repair' },
      { key: 'pumpfile', label: 'Pump purchase approval (EE PHED)', dept: 'PHED', type: 'file', ref: fileId.RAUNIA_PUMP },
      { key: 'water', label: 'Nal Jal supply restoration (PHED)', dept: 'PHED', type: 'work', ref: workId.RAUNIA_WATER, dependsOn: 'pumpfile' },
      { key: 'hp', label: 'Campus handpump repair & water test (PHED)', dept: 'PHED', type: 'finding', ref: findingId.RAUNIA_HP },
    ]);
    addInit('INIT-GOG-01', 'All-weather connectivity: Maheshkhunt – Pasraha road', '5.8 km MMGSY road open to traffic, linking three panchayats to NH-31', 'GOG', null, ahead(75), [
      { key: 'land', label: 'Land demarcation at Ch. 3.2 km (Revenue)', dept: 'REV', type: 'file', ref: fileId.GOG_LAND },
      { key: 'road', label: 'Road construction (Rural Works)', dept: 'RWD', type: 'work', ref: workId.MAHESHKHUNT_ROAD, dependsOn: 'land' },
      { key: 'bill', label: '3rd RA bill payment (Treasury)', dept: 'FIN', type: 'file', ref: fileId.GOG_BILL },
    ]);
    addInit('INIT-ALA-02', 'New Anganwadi building — AWC 114, Sahsi', 'Move 38 children and 22 mothers from a rented room to a safe AWC building', 'ALA', sahsi, ahead(150), [
      { key: 'noc', label: 'Land NOC (Circle Office, Alauli)', dept: 'REV', type: 'file', ref: fileId.SAHSI_NOC },
      { key: 'build', label: 'AWC construction (ICDS – MGNREGA)', dept: 'ICDS', type: 'work', ref: workId.SAHSI_AWC, dependsOn: 'noc' },
      { key: 'room', label: 'Unsafe rented room finding', dept: 'ICDS', type: 'finding', ref: findingId.SAHSI_ROOM, dependsOn: 'build' },
    ]);
    addInit('INIT-BEL-01', 'Operationalise HWC Tilathi as a delivery point', '24×7 delivery point at the new Tilathi Health & Wellness Centre', 'BEL', tilathi, ahead(45), [
      { key: 'bldg', label: 'HWC building (Health)', dept: 'HLT', type: 'work', ref: workId.TILATHI_HWC },
      { key: 'water', label: 'Piped water connection (PHED)', dept: 'PHED', type: 'finding', ref: findingId.TILATHI_WATER, dependsOn: 'bldg' },
      { key: 'anmfile', label: 'ANM posting order (Civil Surgeon)', dept: 'HLT', type: 'file', ref: fileId.TILATHI_ANM },
      { key: 'anm', label: 'ANM vacancy finding', dept: 'HLT', type: 'finding', ref: findingId.TILATHI_ANM, dependsOn: 'anmfile' },
    ]);

    // ---------- review meetings & action items ----------
    const m1 = insert(db, 'meetings', { title: 'District Development Review Meeting', meeting_date: ago(26), chaired_by: U.DM, status: 'held', minutes: 'Reviewed delayed works, pending files and service gaps. Actions assigned with deadlines.', created_at: ts(ago(30)) });
    insert(db, 'meetings', { title: 'Monthly DM Review Meeting', meeting_date: ahead(2), chaired_by: U.DM, status: 'scheduled', minutes: null, created_at: ts(ago(3)) });
    const addAction = (a: { key: string; cat: string; title: string; decision: string; to: number; dept: string | null; block: string | null; deadline: string; status: string; refType: string; refId: number; note?: string; closedAgo?: number }) => {
      const id = insert(db, 'action_items', {
        meeting_id: m1, agenda_key: a.key, agenda_category: a.cat, title: a.title, decision: a.decision, assigned_to: a.to,
        department_id: a.dept ? D[a.dept] : null, block_id: a.block ? B[a.block] : null, deadline: a.deadline, status: a.status,
        ref_type: a.refType, ref_id: a.refId, progress_note: a.note ?? null, created_by: U.DM, created_at: ts(ago(26), 16), updated_at: ts(ago(a.closedAgo ?? randint(2, 12)), 12),
        closed_at: a.status === 'closed' ? ts(ago(a.closedAgo ?? 5), 17) : null, closed_by: a.status === 'closed' ? U.DDC : null,
      });
      audit(ts(ago(26), 16), U.DM, 'action.created', 'action', id, `Review decision: ${a.title}`);
      return id;
    };
    addAction({ key: `work:${workId.MAHESHKHUNT_ROAD}`, cat: 'work_delay', title: 'Complete demarcation at Ch. 3.2 km, MMGSY Maheshkhunt–Pasraha', decision: 'CO Gogri to demarcate with police help and report; EE RWD to re-mobilise contractor within 3 days of demarcation.', to: U.CO_GOG, dept: 'REV', block: 'GOG', deadline: ago(12), status: 'open', refType: 'work', refId: workId.MAHESHKHUNT_ROAD });
    addAction({ key: `file:${fileId.RAUNIA_FUND}`, cat: 'file_delay', title: 'Clear revised allotment for UMS Raunia repair', decision: 'DTO to confirm budget availability; DDC to accord revised AA in the same week.', to: U.DTO, dept: 'FIN', block: 'ALA', deadline: ago(16), status: 'in_progress', refType: 'file', refId: fileId.RAUNIA_FUND, note: 'Budget head 2202-01 re-appropriation sought from department.' });
    addAction({ key: `finding:${findingId.RAUNIA_NJ}`, cat: 'critical_finding', title: 'Restore Nal Jal supply in Ward 7, Raunia', decision: 'EE PHED to approve pump purchase; JE to restore supply and submit photo of running taps.', to: U.JE_ALA, dept: 'PHED', block: 'ALA', deadline: ago(5), status: 'open', refType: 'finding', refId: findingId.RAUNIA_NJ });
    const a4 = addAction({ key: `gap:HLT-FIC:${B.ALA}`, cat: 'service_gap', title: 'Catch-up immunisation sessions in Alauli', decision: 'MOIC Alauli to hold catch-up sessions at 12 sub-centres with missed due-lists; report coverage.', to: U.MOIC_ALA, dept: 'HLT', block: 'ALA', deadline: ago(4), status: 'resolution_submitted', refType: 'scheme_target', refId: 0, note: '11 of 12 sessions held; 486 children covered.' });
    addEvidence('action', a4, 'alauli_catchup_sessions_report.svg', 'Catch-up immunisation sessions — Alauli', 'PHC Alauli', U.MOIC_ALA, 2, 'pending', null, null, 'Session-wise due-list coverage report and photographs.');
    addAction({ key: `gap:SW-PEN:${B.BEL}`, cat: 'service_gap', title: 'Pension verification camps in Beldaur', decision: 'BDO Beldaur to hold panchayat-wise life-certificate camps; target 4,000 verifications.', to: U.BDO_BEL, dept: 'ICDS', block: 'BEL', deadline: ahead(4), status: 'in_progress', refType: 'scheme_target', refId: 0, note: 'Camps held in 9 of 16 panchayats.' });
    const a6 = addAction({ key: 'misc:gogri-handpumps', cat: 'critical_finding', title: 'Repair 14 non-functional handpumps in Gogri', decision: 'JE PHED Gogri to repair and submit ward-wise photo evidence.', to: U.JE_GOG, dept: 'PHED', block: 'GOG', deadline: ago(10), status: 'closed', refType: 'misc', refId: 0, closedAgo: 6 });
    addEvidence('action', a6, 'gogri_handpump_repairs.svg', '14 handpumps repaired — Gogri', 'Gogri block', U.JE_GOG, 9, 'accepted', U.DDC, 'Verified by AE through random check of 4 sites.', 'Ward-wise list with photographs.');
    const a7 = addAction({ key: `work:${workId.ROHIYAR_SCHOOL}`, cat: 'work_delay', title: 'Show-cause to contractor for slow progress, UMS Rohiyar', decision: 'DPO SSA to issue show-cause and obtain a weekly work plan.', to: U.SSA, dept: 'EDU', block: 'CHT', deadline: ago(19), status: 'closed', refType: 'work', refId: workId.ROHIYAR_SCHOOL, closedAgo: 15 });
    addEvidence('action', a7, 'rohiyar_showcause_notice.svg', 'Show-cause notice issued — UMS Rohiyar', 'DPO SSA office', U.SSA, 17, 'accepted', U.DDC, 'Notice copy and contractor reply received.', 'Notice no. 1123 dated as uploaded.');
    addAction({ key: `finding:${findingId.TILATHI_ANM}`, cat: 'coordination', title: 'Post ANM at HWC Tilathi', decision: 'Civil Surgeon to issue posting order so delivery point can start.', to: U.CS, dept: 'HLT', block: 'BEL', deadline: ago(10), status: 'open', refType: 'finding', refId: findingId.TILATHI_ANM });

    // ---------- earlier data import record ----------
    insert(db, 'import_batches', { at: ts(ago(18), 11), user_id: U.EERWD, dataset: 'works', file_name: 'RWD_PHED_progress_Oct2026.csv', total: 46, created: 0, updated: 44, failed: 2, errors: JSON.stringify([{ row: 17, message: 'Unknown block "Gogri Jamalpur" — map to Gogri' }, { row: 31, message: 'Physical progress 112 is above 100' }]) });

    audit(nowIso, null, 'system.seed', 'system', null, 'Database initialised with the Khagaria demo dataset (synthetic records).');
    insert(db, 'meta', { key: 'seeded_at', value: nowIso });
    insert(db, 'meta', { key: 'schema_version', value: String(SCHEMA_VERSION) });
  });
}
