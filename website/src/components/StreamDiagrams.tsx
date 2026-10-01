import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

type T = (en: string, zh: string) => string;

function useT(): T {
  const {i18n} = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh';
  return (en, z) => (zh ? z : en);
}

const box = {fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 1.5, rx: 8} as const;
const boxHi = {fill: '#eef2ff', stroke: '#4d6bfe', strokeWidth: 2, rx: 8} as const;
const boxStore = {fill: '#ecfdf3', stroke: '#12b76a', strokeWidth: 2, rx: 8} as const;
const label = {fontSize: 12, fill: '#0f172a', fontWeight: 600} as const;
const sub = {fontSize: 10, fill: '#64748b'} as const;
const arrow = {stroke: '#4d6bfe', strokeWidth: 1.8, fill: 'none'} as const;

function ArrowMarker({id, color = '#4d6bfe'}: {id: string; color?: string}) {
  return (
    <defs>
      <marker id={id} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
        <path d="M0,0 L7,3 L0,6 z" fill={color} />
      </marker>
    </defs>
  );
}

export function StreamDiagram1() {
  const t = useT();
  return (
    <svg viewBox="0 0 460 150" width="100%" role="img" aria-label={t('Project value stream', '项目级价值流')}>
      <ArrowMarker id="a1" />
      <rect x="8" y="52" width="110" height="46" {...boxHi} />
      <text x="63" y="72" textAnchor="middle" style={label}>{t('Coding Agent', '编码 Agent')}</text>
      <text x="63" y="87" textAnchor="middle" style={sub}>{t('locate · arm · accept', '定位 · 武装 · 验收')}</text>

      <rect x="175" y="52" width="110" height="46" {...box} />
      <text x="230" y="72" textAnchor="middle" style={label}>ARGO MCP</text>
      <text x="230" y="87" textAnchor="middle" style={sub}>{t('read / write', '读 / 写')}</text>

      <rect x="342" y="40" width="110" height="70" {...boxHi} />
      <text x="397" y="62" textAnchor="middle" style={label}>{t('Intent graph', '意图图')}</text>
      <text x="397" y="77" textAnchor="middle" style={sub}>{t('source of truth', '唯一事实源')}</text>
      <rect x="352" y="84" width="90" height="20" rx="5" fill="#fff" stroke="#94a3b8" />
      <text x="397" y="98" textAnchor="middle" style={sub}>{t('long-term memory', '长期记忆')}</text>

      <path d="M118 66 H172" style={arrow} markerEnd="url(#a1)" />
      <path d="M285 66 H339" style={arrow} markerEnd="url(#a1)" />
      <path d="M339 92 H285" style={arrow} markerEnd="url(#a1)" />
      <path d="M172 92 H118" style={arrow} markerEnd="url(#a1)" />
      <text x="230" y="135" textAnchor="middle" style={sub}>{t('closed loop: write → read → verify', '闭环：写 → 读 → 验')}</text>
    </svg>
  );
}

export function StreamDiagram2() {
  const t = useT();
  const proj = (x: number, name: string) => (
    <g>
      <rect x={x} y="10" width="74" height="34" {...box} />
      <text x={x + 37} y="31" textAnchor="middle" style={sub}>{name}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 460 170" width="100%" role="img" aria-label={t('Organization value stream', '组织级价值流')}>
      <ArrowMarker id="a2" color="#12b76a" />
      {proj(8, t('project A', '项目 A'))}
      {proj(96, t('project B', '项目 B'))}
      {proj(184, t('project C', '项目 C'))}

      <rect x="120" y="66" width="220" height="46" {...boxStore} />
      <text x="230" y="86" textAnchor="middle" style={label}>{t('Federation + Graph Store', '联邦 + Graph Store')}</text>
      <text x="230" y="101" textAnchor="middle" style={sub}>{t('registry · authz · hosted replicas', '注册 · 授权 · 托管副本')}</text>

      <path d="M45 44 V62 H200" stroke="#12b76a" strokeWidth="1.6" fill="none" markerEnd="url(#a2)" />
      <path d="M133 44 V62" stroke="#12b76a" strokeWidth="1.6" fill="none" markerEnd="url(#a2)" />
      <path d="M221 44 V62" stroke="#12b76a" strokeWidth="1.6" fill="none" markerEnd="url(#a2)" />

      <rect x="150" y="128" width="160" height="34" {...boxStore} />
      <text x="230" y="149" textAnchor="middle" style={label}>{t('Organization-level graph', '组织级图谱')}</text>
      <path d="M230 112 V126" stroke="#12b76a" strokeWidth="1.8" fill="none" markerEnd="url(#a2)" />
      <text x="400" y="90" textAnchor="middle" style={sub}>{t('projects = bricks', '项目 = 积木')}</text>
    </svg>
  );
}

export function StreamDiagram3() {
  const t = useT();
  return (
    <svg viewBox="0 0 460 170" width="100%" role="img" aria-label={t('Enabling architecture', '支撑架构')}>
      <ArrowMarker id="a3" />
      <rect x="20" y="14" width="420" height="40" rx="8" fill="#fff7ed" stroke="#f79009" strokeWidth="2" />
      <text x="34" y="34" style={label}>{t('Pluggable ontology', '本体可插拔')}</text>
      <text x="34" y="48" style={sub}>{t('ArchiMate 3.2  |  custom / other ontologies', 'ArchiMate 3.2  |  自定义 / 其它本体')}</text>

      <path d="M230 56 V74" style={arrow} markerEnd="url(#a3)" />
      <path d="M230 92 V72" style={arrow} markerEnd="url(#a3)" />

      <rect x="20" y="94" width="420" height="62" rx="8" fill="#eef2ff" stroke="#4d6bfe" strokeWidth="2" />
      <text x="34" y="114" style={label}>{t('Read/Write MCP (decoupled)', '读写 MCP（解耦）')}</text>
      <text x="34" y="130" style={sub}>{t('write governance · performance · precision & recall · metrics', '写入治理 · 性能与效率 · 准确率与召回率 · 度量')}</text>
      <text x="34" y="146" style={sub}>{t('applies to any project graph — improves independently', '适用于任意项目图——可独立持续优化')}</text>
    </svg>
  );
}
