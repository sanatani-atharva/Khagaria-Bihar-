// Cross-department dependency graph, drawn as plain SVG (no chart library).
// Columns run left to right by dependency depth; the initiative's OUTCOME sits at the far
// right. An arrow means "the next step cannot finish until this one is done". Every box is a
// link to the live record (work, file or inspection finding) its status is derived from.

import { ArrowDown, Flag } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { ProcOutput } from '../../../core/rpc';
import type { Tone } from '../../../core/types';
import { Badge, cx } from '../ui';
import { INITIATIVE_STATUS, componentState } from './shared';

export type Initiative = ProcOutput<'deps.list'>[number];
export type Component = Initiative['links'][number];

// ---------------------------------------------------------------- model

export interface GraphModel {
  byId: Map<number, Component>;
  /** Effective upstream link (cycle-safe). */
  parent: Map<number, Component | undefined>;
  children: Map<number, Component[]>;
  depth: Map<number, number>;
  slot: Map<number, number>;
  roots: Component[];
  /** Components nothing else depends on: they feed the outcome directly. */
  terminals: Component[];
  /** One track per root, each in upstream -> downstream (pre-order) sequence. */
  tracks: { link: Component; depth: number }[][];
  ordered: Component[];
  maxDepth: number;
  slots: number;
}

export function buildGraph(links: Component[]): GraphModel {
  const byId = new Map(links.map((l) => [l.id, l]));
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  const getDepth = (l: Component): number => {
    const known = depth.get(l.id);
    if (known !== undefined) return known;
    if (visiting.has(l.id)) return 0; // break dependency cycles
    visiting.add(l.id);
    const up = l.depends_on_link_id ? byId.get(l.depends_on_link_id) : undefined;
    const d = up && up.id !== l.id ? getDepth(up) + 1 : 0;
    visiting.delete(l.id);
    depth.set(l.id, d);
    return d;
  };
  links.forEach((l) => getDepth(l));

  const parent = new Map<number, Component | undefined>();
  const children = new Map<number, Component[]>();
  for (const l of links) {
    const up = l.depends_on_link_id ? byId.get(l.depends_on_link_id) : undefined;
    const valid = up && depth.get(l.id) === (depth.get(up.id) ?? 0) + 1 ? up : undefined;
    parent.set(l.id, valid);
    if (valid) children.set(valid.id, [...(children.get(valid.id) ?? []), l]);
  }
  const roots = links.filter((l) => !parent.get(l.id));

  // tidy layout: each terminal gets its own row; a parent sits at the mean of its children
  const slot = new Map<number, number>();
  let next = 0;
  const place = (l: Component) => {
    const ch = children.get(l.id) ?? [];
    if (!ch.length) {
      slot.set(l.id, next++);
      return;
    }
    ch.forEach(place);
    slot.set(l.id, ch.reduce((s, c) => s + (slot.get(c.id) ?? 0), 0) / ch.length);
  };
  roots.forEach(place);

  const tracks = roots.map((r) => {
    const out: { link: Component; depth: number }[] = [];
    const walk = (l: Component) => {
      out.push({ link: l, depth: depth.get(l.id) ?? 0 });
      (children.get(l.id) ?? []).forEach(walk);
    };
    walk(r);
    return out;
  });

  return {
    byId,
    parent,
    children,
    depth,
    slot,
    roots,
    terminals: links.filter((l) => !(children.get(l.id) ?? []).length),
    tracks,
    ordered: tracks.flat().map((t) => t.link),
    maxDepth: Math.max(0, ...links.map((l) => depth.get(l.id) ?? 0)),
    slots: Math.max(1, next),
  };
}

/** Every component downstream of `id` (that cannot finish until it does). */
export function downstreamOf(model: GraphModel, id: number): Component[] {
  const out: Component[] = [];
  const walk = (x: number) => {
    for (const c of model.children.get(x) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

// ---------------------------------------------------------------- text helpers

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(1, max - 1)).replace(/[\s,;:·—-]+$/, '') + '…' : s;
}

function wrap(text: string, max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= max) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.map((l) => clip(l, max));
  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  // the next word did not fit on the last kept line, so this always clips and adds an ellipsis
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]} ${lines[maxLines]}`, max);
  return kept;
}

// Literal class names so the Tailwind scanner sees them.
const SVG_TONE: Record<Tone, { stroke: string; fill: string; soft: string }> = {
  ok: { stroke: 'stroke-ok', fill: 'fill-ok', soft: 'fill-ok-soft' },
  info: { stroke: 'stroke-info', fill: 'fill-info', soft: 'fill-info-soft' },
  warn: { stroke: 'stroke-warn', fill: 'fill-warn', soft: 'fill-warn-soft' },
  bad: { stroke: 'stroke-bad', fill: 'fill-bad', soft: 'fill-bad-soft' },
  critical: { stroke: 'stroke-critical', fill: 'fill-critical', soft: 'fill-critical-soft' },
  muted: { stroke: 'stroke-ink-3', fill: 'fill-ink-3', soft: 'fill-subtle' },
};

const NODE_W = 208;
const COL_GAP = 44;
const ROW_GAP = 20;
const OUT_W = 216;
const LABEL_CHARS = 23;
const LINE_H = 16;
const PAD_X = 8;
const PAD_TOP = 20;
const PAD_BOTTOM = 8;
const INNER = NODE_W - 24;

function a11yLabel(l: Component, isBottleneck: boolean, upstream?: Component) {
  const st = componentState(l);
  return [
    `${l.departmentName || 'Department'}: ${l.label}.`,
    `Status: ${st.word} — ${l.statusLabel}.`,
    isBottleneck ? 'This is the root bottleneck.' : '',
    l.waiting && upstream ? `Waiting on: ${upstream.label}.` : '',
    l.ownerName ? `Owner: ${l.ownerName}${l.ownerDesignation ? `, ${l.ownerDesignation}` : ''}.` : 'Owner not assigned.',
    `Open ${l.refTitle}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------- SVG graph

/** Shorten long department names the way office notes do, then clip. */
function deptShort(name: string): string {
  if (!name) return 'Department not set';
  const s = name.length > 28 ? name.replace(/Engineering/g, 'Engg.').replace(/Department/g, 'Dept.').replace(/Development/g, 'Dev.') : name;
  return clip(s, 30);
}

export function DependencyGraph({ ini, model, bottleneckId }: { ini: Initiative; model: GraphModel; bottleneckId: number | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const cols = model.maxDepth + 1;
  // node height grows with the longest label (1-3 lines) so every box in the graph matches
  const labels = new Map(model.ordered.map((l) => [l.id, wrap(l.label, LABEL_CHARS, 3)]));
  const labelLines = Math.max(1, ...Array.from(labels.values()).map((x) => x.length));
  const NODE_H = 96 + labelLines * LINE_H;
  const ROW_H = NODE_H + ROW_GAP;
  const pillTop = 24 + labelLines * LINE_H + 8;
  const span = model.slots * ROW_H - ROW_GAP;

  const outLines = wrap(ini.outcome, 25, 8);
  const ist = INITIATIVE_STATUS[ini.summary.status];
  const outPill = `${ist.label} · ${ini.summary.progress}% done`;
  const outContentH = 14 + 10 + outLines.length * 17 + 12 + 20;
  const outH = Math.max(span, outContentH + 28);
  const totalH = Math.max(span, outH);
  const nodeOffset = (totalH - span) / 2;

  const colX = (c: number) => PAD_X + c * (NODE_W + COL_GAP);
  const nodeY = (s: number) => PAD_TOP + nodeOffset + s * ROW_H;
  const outX = colX(cols);
  const outY = PAD_TOP + (totalH - outH) / 2;
  const W = outX + OUT_W + PAD_X;
  const H = PAD_TOP + totalH + PAD_BOTTOM;

  const pos = (l: Component) => ({ x: colX(model.depth.get(l.id) ?? 0), y: nodeY(model.slot.get(l.id) ?? 0) });

  const edges: { key: string; d: string; ok: boolean }[] = [];
  for (const l of model.ordered) {
    const up = model.parent.get(l.id);
    if (!up) continue;
    const a = pos(up);
    const b = pos(l);
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x - 3;
    const y2 = b.y + NODE_H / 2;
    edges.push({ key: `${up.id}-${l.id}`, d: `M${x1},${y1} C${x1 + COL_GAP / 2},${y1} ${x2 - COL_GAP / 2},${y2} ${x2},${y2}`, ok: up.done });
  }
  for (const l of model.terminals) {
    const a = pos(l);
    const y = a.y + NODE_H / 2;
    edges.push({ key: `${l.id}-out`, d: `M${a.x + NODE_W},${y} H${outX - 3}`, ok: l.done });
  }

  const pillW = (text: string, size = 11) => Math.round(text.length * size * 0.6 + 18);
  const outContentTop = outY + (outH - outContentH) / 2;

  const outcome = (
    <g>
      <rect x={outX} y={outY} width={OUT_W} height={outH} rx={10} className="fill-accent-soft stroke-accent" strokeWidth={1.5} />
      <text x={outX + 12} y={outContentTop + 11} fontSize={11} fontWeight={700} letterSpacing={0.6} className="fill-accent">
        OUTCOME
      </text>
      <text x={outX + 12} y={outContentTop + 14 + 10 + 13} fontSize={13} fontWeight={700} className="fill-ink">
        {outLines.map((ln, i) => (
          <tspan key={i} x={outX + 12} dy={i ? 17 : 0}>
            {ln}
          </tspan>
        ))}
      </text>
      <rect x={outX + 12} y={outContentTop + 14 + 10 + outLines.length * 17 + 12} width={pillW(outPill)} height={20} rx={10} className={SVG_TONE[ist.tone].soft} />
      <text
        x={outX + 12 + pillW(outPill) / 2}
        y={outContentTop + 14 + 10 + outLines.length * 17 + 12 + 14}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        className={SVG_TONE[ist.tone].fill}
      >
        {outPill}
      </text>
    </g>
  );

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Dependency graph for ${ini.title}. Read left to right; the outcome is on the far right.`}
        className="block h-auto w-full"
        style={{ minWidth: Math.round(W * 0.78), maxWidth: W }}
      >
        <defs>
          <marker id={`${uid}-ok`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-ok" />
          </marker>
          <marker id={`${uid}-wait`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-ink-3" />
          </marker>
        </defs>

        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            strokeWidth={1.75}
            strokeDasharray={e.ok ? undefined : '6 4'}
            className={e.ok ? 'stroke-ok' : 'stroke-ink-3'}
            markerEnd={`url(#${uid}-${e.ok ? 'ok' : 'wait'})`}
          />
        ))}

        {ini.asset ? (
          <a href={`#/assets/${ini.asset.id}`} className="group" aria-label={`Outcome: ${ini.outcome}. ${outPill}. Open facility ${ini.asset.name}.`}>
            <title>{`${ini.outcome} — open ${ini.asset.name}`}</title>
            <rect x={outX - 4} y={outY - 4} width={OUT_W + 8} height={outH + 8} rx={13} fill="none" strokeWidth={2.5} className="stroke-accent opacity-0 group-focus-visible:opacity-100" />
            {outcome}
          </a>
        ) : (
          <g role="img" aria-label={`Outcome: ${ini.outcome}. ${outPill}.`}>
            {outcome}
          </g>
        )}

        {model.ordered.map((l) => {
          const { x, y } = pos(l);
          const st = componentState(l);
          const tone = SVG_TONE[st.tone];
          const isB = l.id === bottleneckId;
          const up = model.parent.get(l.id);
          const label = labels.get(l.id) ?? [l.label];
          const pw = pillW(st.word);
          const label2 = a11yLabel(l, isB, up);
          return (
            <a key={l.id} href={`#${l.refLink}`} className="group" aria-label={label2}>
              <title>{label2}</title>
              <rect x={x - 4} y={y - 4} width={NODE_W + 8} height={NODE_H + 8} rx={12} fill="none" strokeWidth={2.5} className="stroke-accent opacity-0 group-focus-visible:opacity-100" />
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={9}
                strokeWidth={isB ? 3.5 : 1.5}
                className={cx('fill-panel transition-colors group-hover:fill-subtle', isB ? 'stroke-critical' : tone.stroke)}
              />
              <text x={x + 12} y={y + 20} fontSize={11} fontWeight={700} className="fill-ink-3">
                {deptShort(l.departmentName)}
              </text>
              <text x={x + 12} y={y + 40} fontSize={13} fontWeight={700} className="fill-ink">
                {label.map((ln, i) => (
                  <tspan key={i} x={x + 12} dy={i ? LINE_H : 0}>
                    {ln}
                  </tspan>
                ))}
              </text>
              <rect x={x + 12} y={y + pillTop} width={pw} height={20} rx={10} className={tone.soft} />
              <text x={x + 12 + pw / 2} y={y + pillTop + 14} textAnchor="middle" fontSize={11} fontWeight={700} className={tone.fill}>
                {st.word}
              </text>
              <text x={x + 12} y={y + pillTop + 38} fontSize={11.5} fontWeight={700} className="fill-ink-2">
                {clip(l.statusLabel, Math.floor(INNER / 6.4))}
              </text>
              <text x={x + 12} y={y + pillTop + 55} fontSize={11.5} className="fill-ink-3">
                {clip(l.ownerName ? `Owner: ${l.ownerName}` : 'Owner not assigned', Math.floor(INNER / 6.2))}
              </text>
              {isB && (
                <g aria-hidden>
                  <rect x={x + NODE_W - 100} y={y - 10} width={92} height={20} rx={10} className="fill-critical" />
                  <text x={x + NODE_W - 54} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={0.6} className="fill-white">
                    BOTTLENECK
                  </text>
                </g>
              )}
            </a>
          );
        })}
      </svg>
    </div>
  );
}

export function GraphLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-3">
      <li className="inline-flex items-center gap-1.5">
        <svg width="28" height="8" aria-hidden>
          <line x1="0" y1="4" x2="28" y2="4" strokeWidth="2" className="stroke-ok" />
        </svg>
        Prerequisite done
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg width="28" height="8" aria-hidden>
          <line x1="0" y1="4" x2="28" y2="4" strokeWidth="2" strokeDasharray="5 3" className="stroke-ink-3" />
        </svg>
        Still waiting on prerequisite
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded border-[3px] border-critical" aria-hidden />
        Root bottleneck
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded border-2 border-bad" aria-hidden />
        Blocked or past its limits
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded border-2 border-warn" aria-hidden />
        Pending
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded border-2 border-ok" aria-hidden />
        Done
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- phone layout

/** Ordered chain list used instead of the SVG on narrow screens. */
export function ChainList({ ini, model, bottleneckId }: { ini: Initiative; model: GraphModel; bottleneckId: number | null }) {
  const ist = INITIATIVE_STATUS[ini.summary.status];
  return (
    <div>
      <ol className="space-y-4">
        {model.tracks.map((track, ti) => (
          <li key={track[0].link.id}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
              Track {ti + 1} of {model.tracks.length}
            </div>
            <ol className="space-y-1">
              {track.map(({ link: l, depth }, i) => {
                const st = componentState(l);
                const isB = l.id === bottleneckId;
                const up = model.parent.get(l.id);
                return (
                  <li key={l.id} style={{ marginLeft: Math.min(depth, 4) * 12 }}>
                    {i > 0 && (
                      <div className="flex items-center gap-1 py-0.5 pl-3 text-[11px] font-semibold text-ink-3">
                        <ArrowDown className="size-3.5" aria-hidden /> then
                      </div>
                    )}
                    <Link
                      to={l.refLink}
                      className={cx(
                        'block rounded-lg border bg-panel p-3 transition-colors hover:bg-subtle',
                        isB ? 'border-[3px] border-critical' : l.done ? 'border-ok/50' : l.blocked ? 'border-bad/60' : 'border-warn/50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-ink-3">
                          Step {i + 1} · {l.departmentName || 'Department not set'}
                        </span>
                        {isB && <Badge tone="critical">Bottleneck</Badge>}
                      </div>
                      <div className="mt-0.5 font-semibold leading-snug text-ink">{l.label}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={st.tone}>{st.word}</Badge>
                        <span className="text-xs font-semibold text-ink-2">{l.statusLabel}</span>
                      </div>
                      {l.waiting && up && <p className="mt-1 text-xs text-warn">Waiting on: {up.label}</p>}
                      <p className="mt-1 text-xs text-ink-3">{l.ownerName ? `Owner: ${l.ownerName}` : 'Owner not assigned'}</p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-1 py-0.5 pl-3 text-[11px] font-semibold text-ink-3">
        <ArrowDown className="size-3.5" aria-hidden /> all tracks lead to
      </div>
      <div className="rounded-lg border border-accent/40 bg-accent-soft/60 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-accent">
          <Flag className="size-3.5" aria-hidden /> Outcome
        </div>
        <p className="mt-0.5 text-sm font-semibold text-ink">{ini.outcome}</p>
        <div className="mt-1.5">
          <Badge tone={ist.tone}>
            {ist.label} · {ini.summary.progress}% done
          </Badge>
        </div>
      </div>
    </div>
  );
}
