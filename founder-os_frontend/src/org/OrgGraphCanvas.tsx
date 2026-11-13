"use client";

// OrgGraphCanvas — the chart as a pan/zoom node graph (React Flow, ssr:false).
//
// Pure layout (~40 lines, no dagre): depth from the reports_to chain, x by
// order in the layer. Nodes are position faces; click pins the inspector rail.
import { useMemo } from "react";
import {
  ReactFlow, MiniMap, Controls, Background, BackgroundVariant,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildOrgTree, type OrgTreeNode } from "@/hr/organization";
import type { OrgPerson } from "@/org/api";
import OrgGraphNode, { type OrgNodeData } from "./OrgGraphNode";

export const orgNodeTypes = { orgNode: OrgGraphNode };

const DEPT_HEX: Record<string, string> = {
  Sales: "#6366f1",
  "Digital Marketing": "#d946ef",
  Accounts: "#10b981",
  "Operations & Support": "#f59e0b",
};

const NODE_W = 228;
const GAP_X = 48;
const GAP_Y = 150;

function depthOf(title: string, parentOf: Map<string, string | null>): number {
  let depth = 0;
  let cur: string | null | undefined = title;
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

export default function OrgGraphCanvas({ people, selected, onSelect }: {
  people: OrgPerson[];
  selected: string | null;
  onSelect: (title: string | null) => void;
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

  const { nodes, edges } = useMemo(() => {
    const tree = buildOrgTree();
    const flat: OrgTreeNode[] = [];
    const walk = (n: OrgTreeNode) => { flat.push(n); n.children.forEach(walk); };
    walk(tree);
    const parentOf = new Map<string, string | null>();
    for (const n of flat) {
      if (n.isTop) parentOf.set(n.title, null);
      else parentOf.set(n.title, n.reportsTo);
    }
    const byDepth = new Map<number, OrgTreeNode[]>();
    for (const n of flat) {
      const d = depthOf(n.title, parentOf);
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
          isTop: n.isTop,
          people: nodePeople,
          selected: selected === n.title,
        };
        nodes.push({
          id: n.title,
          type: "orgNode",
          position: { x: i * (NODE_W + GAP_X) - width / 2, y: depth * GAP_Y },
          data: data as unknown as Record<string, unknown>,
        });
        if (!n.isTop && n.reportsTo && flat.some((f) => f.title === n.reportsTo)) {
          edges.push({
            id: `${n.reportsTo}->${n.title}`,
            source: n.reportsTo!,
            target: n.title,
            style: { strokeWidth: 2 },
          });
        }
      });
    }
    return { nodes, edges };
  }, [peopleByTitle, selected]);

  return (
    <div className="h-[520px] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
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
          nodeColor={(n) => DEPT_HEX[String((n.data as any)?.department ?? "")] ?? "#a1a1aa"}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
