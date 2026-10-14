import {useEffect, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {registryDiscover, registryGrants, type FederationMember, type FederationGrant} from '../lib/mcp';
import styles from './federation.module.css';

type T = (en: string, zh: string) => string;

function scopeLabel(contentId: string, t: T): string {
  return !contentId || contentId === '*' ? t('All open content', '全部开放内容') : contentId;
}

function GrantList({title, items, otherLabel, t}: {title: string; items: Array<{other: string; contentId: string; at?: string}>; otherLabel: string; t: T}) {
  if (items.length === 0) return <p className={styles.meta}>{title}: {t('none', '无')}</p>;
  return (
    <>
      <h4>{title}（{items.length}）</h4>
      <ul className={styles.grants}>
        {items.map((it, i) => (
          <li key={i}>
            {otherLabel} <code>{it.other}</code> —— {t('scope', '范围')}: <strong>{scopeLabel(it.contentId, t)}</strong>
            {it.at && <span className={styles.meta}> （{it.at.slice(0, 10)}）</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function MemberCard({member, grants, selected, onSelect, t}: {member: FederationMember; grants: FederationGrant[]; selected: boolean; onSelect: () => void; t: T}) {
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
        <p className={styles.meta}>
          {t('Based on ontology', '所基于本体')}:{' '}
          {member.ontology
            ? <Link to={`/ontology-detail?id=${encodeURIComponent(member.ontology)}`}><code>{member.ontology}</code></Link>
            : <span>{t('not declared', '未标注')}</span>}
        </p>
        {member.capabilities.length > 0 && (
          <div className={styles.chips}>
            {member.capabilities.map((cap) => (<span key={cap} className={styles.chip}>{cap}</span>))}
          </div>
        )}
        {member.openContent.length > 0 && (
          <>
            <h4>{t('Open content (references)', '对外开放内容（引用）')}</h4>
            <ul className={styles.openContent}>
              {member.openContent.map((c) => (<li key={c.id}><a href={c.ref} target="_blank" rel="noopener noreferrer">{c.name}</a></li>))}
            </ul>
          </>
        )}
        {selected && (
          <div className={styles.detail}>
            <GrantList title={t('Granted to (outgoing)', '授权给（出）')} items={outgoing} otherLabel={t('grantee', '被授权方')} t={t} />
            <GrantList title={t('Granted by (incoming)', '被授权（入）')} items={incoming} otherLabel={t('grantor', '授权方')} t={t} />
          </div>
        )}
        {!selected && (outgoing.length > 0 || incoming.length > 0) && (
          <p className={styles.meta}>{t('Authorization', '授权关系')}: {t('out', '出')} {outgoing.length} · {t('in', '入')} {incoming.length} {t('(click for details)', '（点击查看明细）')}</p>
        )}
        {member.sourceRepo && <p className={styles.meta}>{t('Source', '来源')} {member.sourceRepo}</p>}
      </div>
    </div>
  );
}

export default function Federation(): JSX.Element {
  const {i18n} = useDocusaurusContext();
  const t: T = (en, zh) => (i18n.currentLocale === 'zh' ? zh : en);
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
    <Layout title={t('Federation members', '联邦成员')} description={t('Registered members and their authorization relationships', '联邦注册中心已登记成员及其授权关系')}>
      <main className="container margin-vert--lg">
        <Heading as="h1">{t('Federation members & authorization', '联邦成员与授权关系')}</Heading>
        <p>
          {t(
            'Live from registry_discover and registry_grants. The center keeps only membership metadata and grants — never content copies; open content is shown as references. Click a member to see its outgoing/incoming grants.',
            '实时来自 registry_discover 与 registry_grants。中心只保存成员元数据与授权，绝不保存内容副本；开放内容以引用呈现。点击成员可查看其授出/被授明细。',
          )}
        </p>

        {loading && <p>{t('Loading…', '加载中…')}</p>}
        {error && <p className={styles.error}>{t('Load failed: ', '加载失败：')}{error}</p>}

        {members && (
          <div className="row margin-top--md">
            {members.length === 0 && <p>{t('No registered members yet.', '暂无已登记成员。')}</p>}
            {members.map((m) => (
              <div className="col col--6" key={m.id}>
                <MemberCard member={m} grants={grants} selected={selectedId === m.id} onSelect={() => setSelectedId(selectedId === m.id ? null : m.id)} t={t} />
              </div>
            ))}
          </div>
        )}
      </main>
    </Layout>
  );
}
