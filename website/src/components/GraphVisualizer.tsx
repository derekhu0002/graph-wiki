import {useMemo} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import type {GraphElement, GraphRelationship} from '../lib/mcp';

// ArchiMate 层级 → 颜色
const LAYER_COLORS: Record<string, string> = {
  Business: '#4d6bfe',
  Application: '#12b76a',
  Technology: '#f79009',
  Motivation: '#f04438',
  Strategy: '#7a5af8',
  Implementation: '#7a5af8',
  default: '#667085',
};

const BUSINESS_TYPES = new Set([
  'Business Actor', 'Business Role', 'Business Collaboration', 'Business Interface',
  'Business Process', 'Business Function', 'Business Interaction', 'Business Event',
  'Business Service', 'Business Object', 'Contract', 'Representation', 'Product',
  'Skill', 'Capability', 'Value Stream', 'Course of Action', 'Meaning', 'Value',
]);
const APP_TYPES = new Set([
  'Application Component', 'Application Collaboration', 'Application Interface',
  'Application Process', 'Application Function', 'Application Interaction',
  'Application Event', 'Application Service', 'Data Object',
]);
const TECH_TYPES = new Set([
  'Node', 'Device', 'System Software', 'Technology Collaboration',
  'Technology Interface', 'Path', 'Communication Network', 'Technology Process',
  'Technology Function', 'Technology Interaction', 'Technology Event',
  'Technology Service', 'Artifact', 'Equipment', 'Facility',
]);
const MOTIVATION_TYPES = new Set([
  'Stakeholder', 'Driver', 'Goal', 'Outcome', 'Principle', 'Requirement',
  'Constraint', 'Assessment',
]);
const STRATEGY_TYPES = new Set(['Resource', 'Grouping', 'Location']);

function layerOf(type: string): string {
  if (BUSINESS_TYPES.has(type)) return 'Business';
  if (APP_TYPES.has(type)) return 'Application';
  if (TECH_TYPES.has(type)) return 'Technology';
  if (MOTIVATION_TYPES.has(type)) return 'Motivation';
  if (STRATEGY_TYPES.has(type)) return 'Strategy';
  if (type === 'Work Package' || type === 'Deliverable' || type === 'Plateau' || type === 'Gap' || type === 'Implementation Event') {
    return 'Implementation';
  }
  return 'default';
}

function colorOf(type: string): string {
  return LAYER_COLORS[layerOf(type)] || LAYER_COLORS.default;
}

function nodeWidth(type: string): number {
  return type.length > 18 ? 220 : type.length > 12 ? 180 : 150;
}

// 圆形布局：把元素均匀分布在圆周
function circlePositions(count: number, radius: number): Array<{x: number; y: number}> {
  const positions: Array<{x: number; y: number}> = [];
  const startAngle = -Math.PI / 2; // 从顶部开始
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (2 * Math.PI * i) / count;
    positions.push({x: Math.cos(angle) * radius, y: Math.sin(angle) * radius});
  }
  return positions;
}

function ElementNode({data}: NodeProps) {
  const color = colorOf(data.type);
  return (
    <div
      style={{
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: '6px 10px',
        background: '#fff',
        maxWidth: data.width,
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        fontFamily: 'inherit',
      }}>
      <Handle type="target" position={Position.Top} style={{opacity: 0}} />
      <div style={{fontSize: 13, fontWeight: 600, color: '#0f172a', wordBreak: 'break-word'}}>
        {data.name}
      </div>
      <div style={{fontSize: 11, color, marginTop: 2}}>{data.type}</div>
      <Handle type="source" position={Position.Bottom} style={{opacity: 0}} />
    </div>
  );
}

const nodeTypes = {element: ElementNode};

type Props = {
  elements: GraphElement[];
  relationships: GraphRelationship[];
};

export default function GraphVisualizer({elements, relationships}: Props) {
  const nodes: Node[] = useMemo(() => {
    const count = elements.length;
    const radius = Math.max(220, count * 42);
    const pos = circlePositions(count, radius);
    return elements.map((el, i) => ({
      id: el.id,
      type: 'element',
      position: pos[i],
      data: {
        name: el.name,
        type: el.type,
        width: nodeWidth(el.type),
      },
    }));
  }, [elements]);

  const edges: Edge[] = useMemo(() => {
    return relationships
      .filter((r) => elements.some((e) => e.id === r.source_id) && elements.some((e) => e.id === r.target_id))
      .map((r, i) => ({
        id: r.id || `e-${i}`,
        source: r.source_id,
        target: r.target_id,
        label: r.type,
        type: 'smoothstep',
        animated: false,
        style: {stroke: '#94a3b8', strokeWidth: 1.5},
        labelStyle: {fill: '#475569', fontSize: 11, fontWeight: 600},
        labelBgStyle: {fill: '#fff', fillOpacity: 0.9},
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
      }));
  }, [relationships, elements]);

  return (
    <div style={{width: '100%', height: 520, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden'}}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{padding: 0.15}}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{hideAttribution: true}}>
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap pannable zoomable style={{width: 130, height: 90}} />
      </ReactFlow>
    </div>
  );
}
