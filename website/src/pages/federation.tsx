import {useEffect, useState} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import {registryDiscover, type FederationMember} from '../lib/mcp';
import styles from './federation.module.css';

function MemberCard({member}: {member: FederationMember}) {
  return (
    <div className={clsx('card', styles.card)}>
      <div className="card__header">
        <h3>{member.name}</h3>
        <code>{member.id}</code>
      </div>
      <div className="card__body">
        {member.role && <p>{member.role}</p>}

        {member.capabilities.length > 0 && (
          <>
            <div className={styles.chips}>
              {member.capabilities.map((cap) => (
                <span key={cap} className={styles.chip}>{cap}</span>
              ))}
            </div>
          </>
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

        {member.sourceRepo && (
          <p className={styles.meta}>来源 {member.sourceRepo}</p>
        )}
      </div>
    </div>
  );
}

export default function Federation(): JSX.Element {
  const [members, setMembers] = useState<FederationMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    registryDiscover()
      .then(setMembers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout
      title="联邦成员"
      description="ArchGraph 联邦注册中心已登记的成员清单（中心只存元数据与授权，不存内容副本）">
      <main className="container margin-vert--lg">
        <Heading as="h1">联邦成员</Heading>
        <p>
          联邦注册中心已登记的成员清单（实时从 <code>registry_discover</code> 拉取）。
          中心只保存成员<strong>元数据与授权</strong>，绝不保存成员内容副本——「对外开放内容」
          以<strong>引用（ref 链接）</strong>呈现，点击后前往成员自身仓库/图谱取内容。
        </p>

        {loading && <p>加载中…</p>}
        {error && <p className={styles.error}>加载失败：{error}</p>}

        {members && (
          <div className="row">
            {members.length === 0 && <p>暂无已登记成员。</p>}
            {members.map((m) => (
              <div className="col col--6" key={m.id}>
                <MemberCard member={m} />
              </div>
            ))}
          </div>
        )}
      </main>
    </Layout>
  );
}
