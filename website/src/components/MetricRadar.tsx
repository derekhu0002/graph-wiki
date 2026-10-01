import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

type T = (en: string, zh: string) => string;
function useT(): T {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  return (en, z) => (zh ? z : en);
}

// Illustrative capability scores (0–100), internal baselines — not a cross-distribution benchmark.
const AXES: Array<{en: string; zh: string; a: number; b: number}> = [
  {en: 'Success', zh: '成功率', a: 98, b: 80},
  {en: 'Evidence recall', zh: '证据召回', a: 100, b: 74},
  {en: 'Evidence precision', zh: '证据精度', a: 86, b: 58},
  {en: 'First-hit', zh: '首次命中', a: 92, b: 54},
  {en: 'Token efficiency', zh: 'Token 效率', a: 88, b: 50},
  {en: 'Speed', zh: '速度', a: 90, b: 62},
];

const CX = 190;
const CY = 178;
const R = 130;

function pt(i: number, value: number): [number, number] {
  const ang = (-90 + (360 / AXES.length) * i) * (Math.PI / 180);
  const r = (R * value) / 100;
  return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)];
}
function poly(values: number[]): string {
  return values.map((v, i) => pt(i, v).join(',')).join(' ');
}
function ring(frac: number): string {
  return AXES.map((_, i) => pt(i, frac * 100).join(',')).join(' ');
}

export default function MetricRadar() {
  const t = useT();
  return (
    <svg viewBox="0 0 380 400" width="100%" style={{maxWidth: 460, margin: '0 auto', display: 'block'}} role="img" aria-label="metric radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="#e2e8f0" strokeWidth="1" />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = pt(i, 100);
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
      })}

      <polygon points={poly(AXES.map((a) => a.b))} fill="rgba(247,144,9,0.18)" stroke="#f79009" strokeWidth="2" />
      <polygon points={poly(AXES.map((a) => a.a))} fill="rgba(77,107,254,0.20)" stroke="#4d6bfe" strokeWidth="2.4" />

      {AXES.map((a, i) => {
        const ang = (-90 + (360 / AXES.length) * i) * (Math.PI / 180);
        const x = CX + (R + 16) * Math.cos(ang);
        const y = CY + (R + 16) * Math.sin(ang);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{fontSize: 11, fill: '#475569', fontWeight: 600}}>
            {t(a.en, a.zh)}
          </text>
        );
      })}

      <g transform="translate(60,372)">
        <rect x="0" y="-9" width="14" height="10" fill="rgba(77,107,254,0.35)" stroke="#4d6bfe" />
        <text x="20" y="0" style={{fontSize: 12, fill: '#0f172a'}}>{t('ArchGraph (intent graph)', 'ArchGraph（意图图）')}</text>
        <rect x="200" y="-9" width="14" height="10" fill="rgba(247,144,9,0.3)" stroke="#f79009" />
        <text x="220" y="0" style={{fontSize: 12, fill: '#0f172a'}}>{t('RAG baseline', 'RAG 基线')}</text>
      </g>
    </svg>
  );
}
