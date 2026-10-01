import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';

import {ONTOLOGIES} from '../data/ontologies';
import styles from './ontologies.module.css';

export default function Ontologies(): JSX.Element {
  return (
    <Layout title="本体货架" description="ArchGraph 支持的建模本体：ArchiMate 3.2 等">
      <main className="container margin-vert--lg">
        <Heading as="h1">本体货架</Heading>
        <p>
          ArchGraph 的图谱由一个<strong>本体（ontology）</strong>定义——即元素/关系的类型体系与校验规则。
          我们以 <strong>ArchiMate 3.2</strong> 为基础本体，并支持接入其它本体。下面按货架方式陈列，
          点击任一本体进入其详细介绍。
        </p>

        <div className="row margin-top--lg">
          {ONTOLOGIES.map((o) => (
            <div className="col col--6" key={o.id}>
              <div className={`card ${styles.card}`}>
                <div className="card__header">
                  <h3>
                    {o.name} {o.version && <span className={styles.version}>v{o.version}</span>}
                    {o.comingSoon && <span className={styles.badge}>建设中</span>}
                  </h3>
                </div>
                <div className="card__body">
                  <p>{o.summary}</p>
                  {o.comingSoon ? (
                    <p className={styles.meta}>敬请期待。</p>
                  ) : (
                    <Link className="button button--primary button--sm" to={`/ontologies/${o.id}`}>
                      查看本详情 →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </Layout>
  );
}
