# Zila Samanvay · ज़िला समन्वय

**District dashboard and administrative workflow management for District Administration, Khagaria (Bihar)**
Working prototype for **Problem Statement 3**, internship invitation **Letter No. 305 dated 07/11/2026**.

Zila Samanvay puts four streams of information in one place: public works progress, non-works schemes and services, file movement, and the condition of departmental assets. It turns them into a ranked, explained agenda for the DM's review meeting. Every review decision becomes an owned action with a deadline. An action closes only after evidence of resolution is uploaded and verified by a second officer.

> All officers, phone numbers, file numbers, amounts and records in this repository are **synthetic demo data**. Block and department names are real; nothing else is.

---

## 1. Run it

### Option A: full stack (recommended for the demo)

Requirements: **Node.js 20.10 or newer** (22.13+ recommended, which uses Node's built-in SQLite).

```bash
npm install && npm run dev
```

Open **http://127.0.0.1:5173** and sign in as any demo officer (one click; production would use NIC/State SSO with OTP). The first start creates and seeds `data/zila-samanvay.db`.

| Command | What it does |
|---|---|
| `npm run dev` | API on :4000 (Express + SQLite) and UI on :5173 (Vite, hot reload) |
| `npm run build && npm start` | Production build; one server on **http://localhost:8080** serving UI + API |
| `npm run build:standalone` | Builds `dist-standalone/index.html`, one self-contained file (see Option B) |
| `npm run db:reset` before a demo | Restores the exact demo story (ageing is generated relative to the reset date) |
| `npm run db:reset` | Wipe and re-seed the Khagaria demo dataset |
| `npm test` | Core behaviour tests (priority engine, file workflow, evidence rules, public-data separation, import) |
| `npm run typecheck` | TypeScript strict check of everything |

### Option B: zero install (single HTML file)

`npm run build:standalone` produces **`dist-standalone/index.html`** (about 2.3 MB). A ready-built copy is saved next to the project as `Zila-Samanvay-Offline-Demo.html`. Double-click it and it opens in any modern browser with no server, no internet and no installation. The same core procedures run in the browser on SQLite compiled to WebAssembly. Changes persist in that browser's IndexedDB. Use it as a fallback for the selection demo, or to share the prototype as one email attachment.

### Option C: Docker (district server / NIC cloud)

```bash
docker build -t zila-samanvay .
docker run -d --name zila-samanvay -p 127.0.0.1:8080:8080 -v zila-data:/data zila-samanvay
```

The container runs as a non-root user and keeps the SQLite database on the `/data` volume. Put it behind the office's HTTPS reverse proxy and set `COOKIE_SECURE=1`.

---

## 2. What Problem Statement 3 asks for, and where it is

| PS-3 requirement | Where in the system |
|---|---|
| One dashboard for public works, non-works programmes, file movement, asset condition | **District dashboard** (`/dashboard`): KPI groups for each stream, block × department heat-map, block table |
| Move from district summary → underlying issue → responsible office → next required action | **Drill-down** (`/drill`): metric → block → department → item, each with responsible officer (phone) and the exact next action; every KPI links here |
| "Improving a school may require building repairs, a functioning water supply and an administrative decision held up in another office" | **Inter-department view** (`/dependencies`): *Middle School Improvement, UMS Raunia* links an Education repair work, PHED water restoration and a fund-allotment file at the District Treasury, and names the root bottleneck. The DM/DDC can define new initiatives by linking live works, files and findings |
| Draw on works-monitoring records and reuse departmental updates | **Import** (`/works/import`): CSV / Excel (.xlsx) sheets with auto column mapping, dry-run validation and upsert by work code or by name + block (no double entry). Scheme MIS exports are imported the same way |
| Non-works monitoring against defined targets | **Schemes & services** (`/schemes`): 8 schemes × 7 blocks, annual target vs cumulative achievement vs pro-rata expectation, trend, persistence of gaps. Targets are set by the DM/DDC or the department's district officer |
| File tracking: where pending, for how long, what decision is required | **File tracker** (`/files`): current desk and holder, days at desk vs SLA, total age, desk-wise pendency, movement history, decision required; Forward / Approve / Query / Reply / Return / Close with timestamps and audit |
| Department-wise asset register by location, responsibility, condition; linked to inspections, findings, follow-up | **Asset register** (`/assets`): schools, AWCs, HWCs/PHCs, handpumps, Nal Jal schemes, Panchayat Sarkar Bhawans; inspection schedule; findings → corrective action → evidence → verification → closure |
| Approved information through the public portal | **Public portal** (`/public`, no sign-in): only works the DDC/DM approved for publication, scheme progress, facility functional status. Internal files, findings, hold reasons and phone numbers never leave the server |
| Turn combined information into priorities for review meetings; flag persistent delays, unresolved findings, service gaps, coordination needs; explain why | **Review meeting** (`/review`): priority engine ranks every candidate with a transparent additive score, a "why flagged" explanation and a score breakdown |
| Review decisions → assigned actions, deadlines, evidence of resolution | **Review Decision Logger** and **Action tracker**: assign officer and deadline; the officer uploads evidence; DM/DDC verifies (the uploader cannot verify their own evidence) |
| Without repeatedly assembling separate reports | **One-click review brief**: CSV export and a print-ready A4 brief (`/review/brief`, save as PDF) |
| Officers follow it through | **My desk** (`/desk`): each officer's queue of files to decide, findings to fix, evidence to verify, actions due, works to update and inspections due |

---

## 3. Architecture

```
            ┌──────────────── Browser (React 18 + TypeScript + Tailwind) ────────────────┐
            │  Dashboard · Drill-down · Dependencies · Works · Schemes · Files · Assets   │
            │  Review · My desk · Audit · Public portal          TanStack Query cache     │
            └──────────────┬───────────────────────────────────────────────┬─────────────┘
                 rpc('works.list', …)                          single-file build only
                           │ POST /api/rpc/:name (JSON)                    │ same call, in-process
            ┌──────────────▼──────────────┐                 ┌──────────────▼─────────────┐
            │ Express API                 │                 │ sql.js (SQLite in WASM)    │
            │ signed-cookie sessions      │                 │ persisted to IndexedDB     │
            │ CSP / CSRF header / limits  │                 └──────────────┬─────────────┘
            └──────────────┬──────────────┘                                │
                           └───────────────►  src/core  ◄──────────────────┘
                   procedures (zod-validated, role-checked, transactional, audited)
                   priority engine · rules (SLA, delay, gap thresholds) · drill-down · seed
                           │
                    SQLite (node:sqlite, WAL)  ── swap for PostgreSQL at state scale
```

* **One core, two runtimes.** `src/core` holds the schema, rules and priority engine. There are 49 procedures. The Express server and the offline single-file build call the same `execute()`, so permissions, validation and audit behave the same everywhere.
* **Database.** SQLite through Node's built-in `node:sqlite` (Node 22.13+), with an automatic fallback to sql.js (WebAssembly) on older Node. No native compilation, no paid services. The relational schema has indexes on every filter path (`src/core/schema.ts`).
* **Business rules in one file** (`src/core/rules.ts`): delay detection (time-based expected progress, overdue, stale reporting, start delay), file SLA bands by category, the service-gap threshold (75% of pro-rata) and the watch band (90%).

### Directory structure

```
zila-samanvay/
├── index.html                    Vite entry
├── package.json  tsconfig.json  vite.config.ts  vite.standalone.config.ts
├── samples/                      works-progress-sample.csv, scheme-progress-sample.csv
├── tests/core.test.ts            behaviour tests (node:test)
└── src/
    ├── core/                     shared by server and offline build
    │   ├── schema.ts             tables + indexes
    │   ├── seed.ts               deterministic Khagaria dataset (7 blocks, 9 departments)
    │   ├── rules.ts              delay / SLA / gap rules
    │   ├── issues.ts             uniform "issue items" for drill-down, heat-map, desk
    │   ├── initiatives.ts        cross-department dependency resolution
    │   ├── priority.ts           review meeting priority engine
    │   ├── context.ts            roles, jurisdiction scoping, audit trail
    │   ├── rpc.ts                procedure registry + executor
    │   └── procedures/           session, dashboard, works, schemes, files, assets,
    │                             review, desk (+deps, audit, admin), public
    ├── server/                   Express API, SQLite adapter, sessions, db:reset
    └── web/
        ├── main.tsx  App.tsx  index.css (design tokens, print styles)
        ├── lib/                  rpc client, offline runtime, hooks, formatting,
        │                         evidence compression, CSV/XLSX parsing
        ├── components/           UI kit, app shell, evidence, issue list, toasts
        └── pages/                Login, Dashboard, Drill, Dependencies, Works, WorkDetail,
                                  WorksImport, Schemes, Files, FileDetail, Assets,
                                  AssetDetail, Review, ReviewBrief, Desk, Audit, PublicPortal
```

---

## 4. Roles and governance

| Role | Sees | Can do |
|---|---|---|
| District Magistrate, DDC | Whole district | Everything; log review decisions; verify evidence; publish works to the public portal; audit trail |
| District department officer (DEO, EE PHED, Civil Surgeon, EE RWD, DPRO, ADM Rev., DPO ICDS, DRDA, DTO) | Own department in all 7 blocks | Update works, act on files at their desk, assign corrective action, verify evidence for their department |
| Block / field officer (BDO, BEO, JE, MOIC, CDPO, CO, AE, BPRO) | Own block (and own department if any) | Update progress, act on files at their desk, record inspections, upload evidence |
| Public | Approved information only | View works, scheme progress and facility status |

* **Jurisdiction is enforced on the server** (`scopeSql` / `inScope`), not just hidden in the UI.
* **Audit trail**: every state change writes officer, role, timestamp and summary to an append-only `audit_log` (file movements, progress updates, imports, inspections, evidence, verifications, decisions, publications, sign-ins).
* **Separation of duties**: whoever uploaded the evidence cannot verify it. Findings and actions cannot close without verified evidence.
* **Evidence integrity**: photos are compressed to WebP in the browser (max 1600 px, ≤2.5 MB). The server recomputes and stores a SHA-256 fingerprint.
* **Public / internal separation**: public procedures select an explicit whitelist of columns from approved records. A test asserts that no internal field leaks.
* **Web security**:
  * HttpOnly SameSite=Strict signed session cookie, revoked on sign-out (a copied cookie stops working);
  * a custom request header on every API call (CSRF defence);
  * strict Content-Security-Policy in production; HSTS when served over HTTPS;
  * zod validation on every input; parameterised SQL everywhere;
  * rate limits on sign-in and on the API; request size and time limits;
  * evidence uploads checked by file signature, so a renamed HTML file is rejected.
* **Known production gap**: the demo's one-click persona sign-in lets anyone choose any role. Set `DEMO_LOGIN=0` and connect the State / NIC single sign-on or OTP before real use.

## 5. Low-bandwidth and field reliability

* Route-level code splitting; the main bundle is about 87 kB gzipped. Fonts are self-hosted. There are no third-party scripts.
* Gzip compression. Hashed assets are cached for a year; `index.html` always revalidates.
* The query cache shows the last data instantly and refreshes in the background. Loading states are skeletons, not blank screens.
* Paginated lists, debounced search, and evidence compressed before upload.
* The offline single-file build works with no network at all, which suits a block office during an outage.

## 6. Priority engine (how items are ranked)

Each candidate gets **additive, visible factors**: the agenda shows the full breakdown, and the factors sum exactly to the score (priority points, no ceiling, so two severe items never tie at a cap; bands: Critical 75+, High 55–74, Medium below 55).

| Category | Flagged when | Main factors |
|---|---|---|
| Persistent work delay | past target, ≥20 points behind time-based expected progress, stalled, start delayed >30 d, or no update >30 d | days overdue, slip, stalled, value (≥₹50 L / ≥₹2 Cr), file blocking it beyond SLA |
| Decision pending beyond SLA | days at current desk > category SLA | overrun relative to SLA, urgent/high priority, blocks a work, amount, repeated queries |
| Unresolved inspection finding | critical, or high and >14 d old or past due, or reopened | severity, age, overdue, no owner assigned, rejected evidence |
| Block service gap | achievement <75% of pro-rata target | depth below threshold, months in a row below, lowest block in district |
| Inter-department coordination | an initiative has ≥2 departments with pending work and ≥1 blocked component | departments involved, blocked components, longest wait, outcome deadline |

Cross-cutting adjustments: **+6 per earlier review meeting** in which the item was already flagged; **+10 if an earlier review action is overdue**; **−8 if an action is assigned and still within its deadline**. Items that belong to a flagged inter-department initiative are folded into that one agenda line.

## 7. Importing existing departmental sheets

`/works/import` accepts `.csv` and `.xlsx`. Headers are mapped automatically (Hindi/English synonyms such as *Name of Work*, *Prakhand*, *AA amount*, *TDC*) and can be adjusted. **Validate** is a dry run that shows *create / update / unchanged / error* per row with reasons; **Import** writes the changes and records an import batch. Rows match an existing work by **work code**, else by **name + block**, so a sheet re-uploaded every month updates records instead of duplicating them. Officers can only import rows in their own jurisdiction. Try the files in `samples/`.

## 8. Tests

```bash
npm test
```

The tests cover:

* seed integrity;
* the school case ranking first with a correct factor sum;
* folding of dependent items;
* the file workflow: holder-only actions, desk, timestamp and audit;
* evidence-before-closure and separation of duties;
* public portal leak checks;
* jurisdiction scoping;
* import upsert and validation;
* the review decision → evidence → verification lifecycle;
* defining an inter-department initiative (at least two departments required);
* target-setting permissions;
* an officer can still open a file they forwarded;
* procedure lookup ignores prototype keys (`__proto__`);
* evidence must really be a photo or PDF;
* audit lookups by record are DM / DDC only.

## 9. Production path (60-day internship)

* Replace demo sign-in with State/NIC SSO + OTP (`DEMO_LOGIN=0`).
* Map real departmental sheets: RWD/PHED progress, HMIS, e-KYC, WQMIS, DBT.
* Move to PostgreSQL on the State Data Centre or NIC cloud. The core uses one small database interface (`src/core/db.ts`).
* Add SMS/WhatsApp reminders for overdue actions and a Hindi UI string pass.
