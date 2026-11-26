"use client";

// OrgGraphCanvas — the chart as a pan/zoom node graph (React Flow, ssr:false).
//
// Positions come from GET /api/org/chart (HR-editable DB rows), people from
// GET /api/org/people. Layout is pure: depth from reportsToId, x by order in
// the layer. Nodes are position faces; click pins the inspector rail.
import { useMemo } from "react";
import {
  ReactFlow, MiniMap, Controls, Background, BackgroundVariant,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildChartTree, type LiveChartPosition, type LiveOrgTreeNode, type OrgWing } from "@/hr/organization";
import type { OrgPerson } from "@/org/api";
import OrgGraphNode, { WING_STYLES, type OrgNodeData } from "./OrgGraphNode";

export const orgNodeTypes = { orgNode: OrgGraphNode };

const WING_HEX: Record<string, string> = {
  Sales: "#6366f1",
  Marketing: "#d946ef",
  Operations: "#f59e0b",
};

const NODE_W = 228;
const GAP_X = 48;
const GAP_Y = 150;

function depthOf(id: string, parentOf: Map<string, string | null>): number {
  let depth = 0;
  let cur: string | null | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = parentOf.get(cur);
    if (!parent) break;
    depth += 1;
    cur = parent;
  }
  return depth;
}

function flatten(root: LiveOrgTreeNode): LiveOrgTreeNode[] {
  const out: LiveOrgTreeNode[] = [];
  const walk = (n: LiveOrgTreeNode) => { out.push(n); n.children.forEach(walk); };
  walk(root);
  return out;
}

export default function OrgGraphCanvas({ positions, people, selected, onSelect }: {
  positions: LiveChartPosition[];
  people: OrgPerson[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const peopleByTitle = useMemo(() => {
    const map = new Map<string, OrgPerson[]>();
    for (const p of people) {
      const key = String(p.employee.designation ?? "").trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [people]);

  const legend = useMemo(() => {
    return (["Sales", "Marketing", "Operations"] as OrgWing[]).map((wing) => ({
      wing,
      covers: positions.filter((p) => p.wing === wing).map((p) => p.title).join(" · ") || "No positions",
    }));
  }, [positions]);

  const { nodes, edges } = useMemo(() => {
    const tree = buildChartTree(positions);
    if (!tree) return { nodes: [] as Node[], edges: [] as Edge[] };
    const flat = flatten(tree);
    const parentOf = new Map<string, string | null>();
    for (const n of flat) parentOf.set(n.id, n.isTop || n.isScopedRoot ? null : n.reportsToId);
    const byDepth = new Map<number, LiveOrgTreeNode[]>();
    for (const n of flat) {
      const d = depthOf(n.id, parentOf);
      const list = byDepth.get(d) ?? [];
      list.push(n);
      byDepth.set(d, list);
    }
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (const [depth, layer] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const width = layer.length * (NODE_W + GAP_X) - GAP_X;
      layer.forEach((n, i) => {
        const nodePeople = n.isTop ? [] : (peopleByTitle.get(n.title) ?? []);
        const data: OrgNodeData = {
          title: n.title,
          department: n.department,
          wing: n.wing,
          isTop: n.isTop,
          people: nodePeople,
          selected: selected === n.id,
        };
        nodes.push({
          id: n.id,
          type: "orgNode",
          position: { x: i * (NODE_W + GAP_X) - width / 2, y: depth * GAP_Y },
          data: data as unknown as Record<string, unknown>,
        });
        if (!n.isTop && n.reportsToId && flat.some((f) => f.id === n.reportsToId)) {
          edges.push({
            id: n.reportsToId + "->" + n.id,
            source: n.reportsToId,
            target: n.id,
            style: { strokeWidth: 2 },
          });
        }
      });
    }
    return { nodes, edges };
  }, [positions, peopleByTitle, selected]);

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        {legend.map(({ wing, covers }) => (
          <span
            key={wing}
            title={covers}
            className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-950/95 dark:text-zinc-300"
          >
            <span className={"h-2 w-2 rounded-full " + WING_STYLES[wing].dot} />
            {wing}
          </span>
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={orgNodeTypes}
        onNodeClick={(_, node) => onSelect(node.id === selected ? null : node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => WING_HEX[String((n.data as any)?.wing ?? "")] ?? "#a1a1aa"}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
