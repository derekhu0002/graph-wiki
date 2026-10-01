import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

type T = (en: string, zh: string) => string;
function useT(): T {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  return (en, z) => (zh ? z : en);
}

// Illustrative values (internal baselines) — directional, not a cross-distribution benchmark.
const ROWS: Array<{en: string; zh: string; a: string; b: string; why: {en: string; zh: string}}> = [
  {en: 'Task success', zh: '任务成功率', a: '~100% (28/28)', b: 'lower', why: {en: 'grounded, inspectable context', zh: '有据可依、可检查的上下文'}},
  {en: 'Evidence recall', zh: '证据召回率', a: 'recall-first (no silent misses)', b: 'lower', why: {en: 'graph structure + two-step recall', zh: '图结构 + 两步回忆'}},
  {en: 'Evidence precision', zh: '证据精度', a: 'improving (rerank)', b: 'noisier', why: {en: 'rerank + thresholds', zh: 'rerank + 阈值'}},
  {en: 'Tokens per task', zh: '每任务 Token', a: 'lean (subgraph scoping)', b: 'higher', why: {en: 'scope reads to the subgraph', zh: '把读取限定到子图'}},
  {en: 'Latency', zh: '时延', a: 'low-ms retrieval', b: 'model-bound', why: {en: 'structural + vector, cached tiers', zh: '结构 + 向量、分层缓存'}},
  {en: 'Abstention', zh: '拒答', a: 'correct refusal', b: 'variable', why: {en: 'explicit no-answer handling', zh: '显式处理“无答案”'}},
  {en: 'Write governance', zh: '写入治理', a: 'dedup / lossless / tombstone', b: 'usually absent', why: {en: 'no silent knowledge loss', zh: '知识不被悄悄丢失'}},
];

export default function MetricComparison() {
  const t = useT();
  const th = {padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontSize: 13} as const;
  const td = {padding: '8px 10px', borderBottom: '1px solid #eef2f7', fontSize: 13, verticalAlign: 'top'} as const;
  return (
    <div style={{overflowX: 'auto', margin: '1rem 0'}}>
      <table style={{width: '100%', borderCollapse: 'collapse', background: '#fff'}}>
        <thead>
          <tr style={{background: '#f8fafc'}}>
            <th style={th}>{t('Metric', '指标')}</th>
            <th style={{...th, color: '#4d6bfe'}}>{t('ArchGraph (intent graph)', 'ArchGraph（意图图）')}</th>
            <th style={{...th, color: '#f79009'}}>{t('RAG baseline', 'RAG 基线')}</th>
            <th style={th}>{t('Why it wins', '为什么更优')}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={i}>
              <td style={{...td, fontWeight: 600}}>{t(r.en, r.zh)}</td>
              <td style={td}>{r.a}</td>
              <td style={td}>{r.b}</td>
              <td style={{...td, color: '#64748b'}}>{t(r.why.en, r.why.zh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{fontSize: 12, color: '#94a3b8', marginTop: 6}}>
        {t('Illustrative internal baselines; not a cross-distribution benchmark.', '示意性内部基线；非跨分布基准。')}
      </p>
    </div>
  );
}
