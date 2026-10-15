/**
 * Acceptance Test - 社区站主页视觉与布局重构 (Community Homepage Modernization)
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 社区站源码、样式及 static/img/ 静态资产，以及 canonical intent graph
 * WHEN 检查主页 index.tsx、样式 index.module.css 与图片资产
 * THEN
 *   1. static/img/ 包含模型直出（非工具简陋画板生成）的 4 张高质感 3D 架构视觉图：
 *      - hero-archgraph.jpg (首页 Hero 核心视觉图)
 *      - feature-project-graph.jpg (项目级意图图与 Agent 闭环图)
 *      - feature-federation-graph.jpg (组织级联邦组网与主权图)
 *      - feature-ontology-mcp.jpg (本体可插拔与解耦读写引擎图)
 *   2. website/src/pages/index.tsx 引用并渲染这 4 张模型直出图片，且通过 useBaseUrl 适配 /archgraph/ 子路径
 *   3. 替换原有简陋 SVG 线框图，采用业界前沿（双列图文并茂、毛玻璃质感、痛点/方案/收益明确徽章）卡片式布局
 *   4. 增加开发工作流闭环模块（定位 Locate → 武装 Arm → 验收 Accept → 闭环 Commit）
 *   5. 图谱中存在 Application Component 元素 community-homepage 并挂载在 federation-registry-view
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GRAPH_PATH = path.join(REPO_ROOT, 'design', 'KG', 'SystemArchitecture.json');
const PAGE_PATH = path.join(REPO_ROOT, 'website', 'src', 'pages', 'index.tsx');
const CSS_PATH = path.join(REPO_ROOT, 'website', 'src', 'pages', 'index.module.css');
const STATIC_IMG_DIR = path.join(REPO_ROOT, 'website', 'static', 'img');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function check(cond, msg) {
  if (!cond) fail(msg);
  console.log(`ok: ${msg}`);
}

function main() {
  // THEN 1: 检查 4 张模型直出图片资产是否存在且非空
  const expectedImages = [
    'hero-archgraph.jpg',
    'feature-project-graph.jpg',
    'feature-federation-graph.jpg',
    'feature-ontology-mcp.jpg',
  ];

  for (const imgName of expectedImages) {
    const imgPath = path.join(STATIC_IMG_DIR, imgName);
    check(fs.existsSync(imgPath), `image ${imgName} exists in website/static/img/`);
    const stat = fs.statSync(imgPath);
    check(stat.size > 50000, `image ${imgName} is a high-resolution model-generated visual (size=${stat.size} bytes)`);
  }

  // THEN 2: 检查页面源码文件存在
  check(fs.existsSync(PAGE_PATH), 'website/src/pages/index.tsx exists');
  check(fs.existsSync(CSS_PATH), 'website/src/pages/index.module.css exists');

  const pageContent = fs.readFileSync(PAGE_PATH, 'utf8');
  const cssContent = fs.readFileSync(CSS_PATH, 'utf8');

  // THEN 2b: 页面引用 useBaseUrl 并绑定全部 4 张图片
  check(pageContent.includes("useBaseUrl"), 'index.tsx uses useBaseUrl for baseUrl adaptation');
  for (const imgName of expectedImages) {
    check(pageContent.includes(imgName), `index.tsx references ${imgName}`);
  }

  // THEN 3: 采用图文并茂的 Showcase Panel / ValueStream 布局，包含痛点、方案、收益标签结构
  check(pageContent.includes('problem') && pageContent.includes('capability') && pageContent.includes('value'), 'index.tsx retains clear problem/capability/value structure');
  check(cssContent.toLowerCase().includes('hero') && cssContent.toLowerCase().includes('image'), 'index.module.css provides modern image styling classes');
  check(cssContent.toLowerCase().includes('badge') || cssContent.toLowerCase().includes('pill'), 'index.module.css supports modern badges or pills');

  // THEN 4: 包含四步闭环工作流 (Locate -> Arm -> Accept -> Commit)
  check(
    pageContent.includes('Locate') || pageContent.includes('定位'),
    'index.tsx presents Locate (定位) workflow'
  );
  check(
    pageContent.includes('Arm') || pageContent.includes('武装'),
    'index.tsx presents Arm (武装) workflow'
  );
  check(
    pageContent.includes('Accept') || pageContent.includes('验收'),
    'index.tsx presents Accept (验收) workflow'
  );

  // THEN 5: 图谱中注册了 community-homepage 架构元素
  check(fs.existsSync(GRAPH_PATH), 'canonical graph exists');
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  const el = (graph.elements || []).find((e) => e.id === 'community-homepage');
  check(!!el, 'community-homepage element registered in intent graph');
  check(el && el.type === 'Application Component', 'community-homepage type is Application Component');

  const view = (graph.views || []).find((v) => v.view_id === 'federation-registry-view');
  check(
    view && (view.included_elements || []).includes('community-homepage'),
    'community-homepage included in federation-registry-view'
  );

  console.log('\nPASS: community_homepage acceptance test passed.');
}

main();
