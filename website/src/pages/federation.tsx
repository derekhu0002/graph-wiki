import {useEffect, useMemo, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';

import {registryDiscover, registryGrants, type FederationMember, type FederationGrant} from '../lib/mcp';
import styles from './federation.module.css';

function scopeLabel(contentId: string): string {
  return !contentId || contentId === '*' ? '全部开放内容' : contentId;
}

function circlePositions(count: number, radius: number): Array<{x: number; y: number}> {
  const out: Array<{x: number; y: number}> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < count; i += 1) {
    const a = start + (2 * Math.PI * i) / Math.max(1, count);
    out.push({x: Math.cos(a) * radius, y: Math.sin(a) * radius});
  }
  return out;
}

function MemberNode({data}: NodeProps) {
  const hl = (data as any).highlight as boolean;
  return (
    <div
      style={{
        border: `2px solid ${hl ? '#4d6bfe' : '#94a3b8'}`,
        background: hl ? '#eef2ff' : '#fff',
        borderRadius: 8,
        padding: '6px 10px',
        textAlign: 'center',
        minWidth: 140,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        cursor: 'pointer',
      }}>
      <Handle type="target" position={Position.Top} style={{opacity: 0}} />
      <div style={{fontSize: 13, fontWeight: 600, color: '#0f172a'}}>{(data as any).name}</div>
      <div style={{fontSize: 11, color: '#64748b'}}>{(data as any).id}</div>
      <Handle type="source" position={Position.Bottom} style={{opacity: 0}} />
    </div>
  );
}

const nodeTypes = {member: MemberNode};

function GrantGraph({
  members,
  grants,
  selectedId,
  onSelect,
}: {
  members: FederationMember[];
  grants: FederationGrant[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ids = new Set(members.map((m) => m.id));
  const nodes: Node[] = useMemo(() => {
    const radius = Math.max(200, members.length * 48);
    const pos = circlePositions(members.length, radius);
    return members.map((m, i) => ({
      id: m.id,
      type: 'member',
      position: pos[i],
      data: {name: m.name, id: m.id, highlight: selectedId === m.id},
    }));
  }, [members, selectedId]);

  const edges: Edge[] = useMemo(
    () =>
      grants
        .filter((g) => ids.has(g.grantor) && ids.has(g.grantee))
        .map((g, i) => {
          const active = selectedId === g.grantor || selectedId === g.grantee;
          const color = active ? '#4d6bfe' : '#94a3b8';
          return {
            id: `g-${i}-${g.grantor}-${g.grantee}-${g.contentId}`,
            source: g.grantor,
            target: g.grantee,
            label: scopeLabel(g.contentId),
            type: 'smoothstep',
            animated: active,
            markerEnd: {type: MarkerType.ArrowClosed, color, width: 18, height: 18},
            style: {stroke: color, strokeWidth: active ? 2.5 : 1.5},
            labelStyle: {fill: '#475569', fontSize: 11, fontWeight: 600},
            labelBgStyle: {fill: '#fff', fillOpacity: 0.92},
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 3,
          };
        }),
    [grants, members, selectedId],
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  return (
    <div style={{width: '100%', height: 460, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fafcff'}}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{padding: 0.18}}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_e, n) => onSelect(selectedId === n.id ? null : n.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{hideAttribution: true}}>
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeLabel={(n) => (n.data as any).id} style={{width: 130, height: 90}} />
      </ReactFlow>
    </div>
  );
}

function GrantList({title, items, otherLabel}: {title: string; items: Array<{other: string; contentId: string; at?: string}>; otherLabel: string}) {
  if (items.length === 0) return <p className={styles.meta}>{title}：无</p>;
  return (
    <>
      <h4>{title}（{items.length}）</h4>
      <ul className={styles.grants}>
        {items.map((it, i) => (
          <li key={i}>
            {otherLabel} <code>{it.other}</code> —— 范围：<strong>{scopeLabel(it.contentId)}</strong>
            {it.at && <span className={styles.meta}> （{it.at.slice(0, 10)}）</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function MemberCard({member, grants, selected, onSelect}: {member: FederationMember; grants: FederationGrant[]; selected: boolean; onSelect: () => void}) {
  const outgoing = grants.filter((g) => g.grantor === member.id).map((g) => ({other: g.grantee, contentId: g.contentId, at: g.grantedAt}));
  const incoming = grants.filter((g) => g.grantee === member.id).map((g) => ({other: g.grantor, contentId: g.contentId, at: g.grantedAt}));
  return (
    <div className={clsx('card', styles.card, selected && styles.cardSelected)} onClick={onSelect}>
      <div className="card__header">
        <h3>{member.name}</h3>
        <code>{member.id}</code>
      </div>
      <div className="card__body">
        {member.role && <p>{member.role}</p>}

        {member.capabilities.length > 0 && (
          <div className={styles.chips}>
            {member.capabilities.map((cap) => (
              <span key={cap} className={styles.chip}>{cap}</span>
            ))}
          </div>
        )}

        {member.openContent.length > 0 && (
          <>
            <h4>对外开放内容（引用）</h4>
            <ul className={styles.openContent}>
              {member.openContent.map((c) => (
                <li key={c.id}>
                  <a href={c.ref} target="_blank" rel="noopener noreferrer">{c.name}</a>
                </li>
              ))}
            </ul>
          </>
        )}

        {selected && (
          <div className={styles.detail}>
            <GrantList title="授权给（出）" items={outgoing} otherLabel="被授权方" />
            <GrantList title="被授权（入）" items={incoming} otherLabel="授权方" />
          </div>
        )}

        {!selected && (outgoing.length > 0 || incoming.length > 0) && (
          <p className={styles.meta}>授权关系：出 {outgoing.length} · 入 {incoming.length}（点击查看明细）</p>
        )}

        {member.sourceRepo && <p className={styles.meta}>来源 {member.sourceRepo}</p>}
      </div>
    </div>
  );
}

export default function Federation(): JSX.Element {
  const [members, setMembers] = useState<FederationMember[] | null>(null);
  const [grants, setGrants] = useState<FederationGrant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([registryDiscover(), registryGrants()])
      .then(([m, g]) => { setMembers(m); setGrants(g); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout
      title="联邦成员"
      description="ArchGraph 联邦注册中心：已登记成员、成员间授权关系与其授权范围">
      <main className="container margin-vert--lg">
        <Heading as="h1">联邦成员与授权关系</Heading>
        <p>
          实时从 <code>registry_discover</code> 与 <code>registry_grants</code> 拉取。中心只保存
          <strong>成员元数据与授权</strong>，绝不保存成员内容副本——「对外开放内容」以<strong>引用</strong>呈现。
          下方图示中节点为成员、有向边为授权（<code>授权方 → 被授权方</code>，标签为授权范围）；点击成员可查看其
          <strong>授出/被授</strong>明细。
        </p>

        {loading && <p>加载中…</p>}
        {error && <p className={styles.error}>加载失败：{error}</p>}

        {members && (
          <>
            <GrantGraph members={members} grants={grants} selectedId={selectedId} onSelect={setSelectedId} />

            <div className="row margin-top--md">
              {members.length === 0 && <p>暂无已登记成员。</p>}
              {members.map((m) => (
                <div className="col col--6" key={m.id}>
                  <MemberCard
                    member={m}
                    grants={grants}
                    selected={selectedId === m.id}
                    onSelect={() => setSelectedId(selectedId === m.id ? null : m.id)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </Layout>
  );
}
