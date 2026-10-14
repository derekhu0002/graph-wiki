'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'DECENTRALIZED-ORG-KNOWLEDGE-GRAPH.md');
const OUT = path.join(__dirname, 'DECENTRALIZED-ORG-KNOWLEDGE-GRAPH.email.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

function render(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => { if (para.length) { out.push('<p style="margin:10px 0;font-size:15px;line-height:1.85;">' + para.map(inline).join('<br>') + '</p>'); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

    if (/^#\s+/.test(line)) { flushPara(); out.push('<h1 style="font-size:24px;color:#0f2b4c;line-height:1.4;margin:6px 0 4px;">' + inline(line.replace(/^#\s+/, '')) + '</h1>'); i++; continue; }
    if (/^##\s+/.test(line)) { flushPara(); out.push('<h2 style="font-size:19px;color:#0f2b4c;border-bottom:3px solid #1d4e89;padding-bottom:8px;margin:26px 0 10px;">' + inline(line.replace(/^##\s+/, '')) + '</h2>'); i++; continue; }
    if (/^###\s+/.test(line)) { flushPara(); out.push('<h3 style="font-size:16px;color:#1d4e89;margin:18px 0 6px;">' + inline(line.replace(/^###\s+/, '')) + '</h3>'); i++; continue; }

    if (/^>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<div style="background:#f2f7fd;border-left:5px solid #1d4e89;border-radius:6px;padding:12px 16px;font-size:13.5px;color:#41506b;margin:12px 0;">' + buf.map(inline).join('<br>') + '</div>');
      continue;
    }

    if (/^\|/.test(line)) {
      flushPara();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let body = '';
      let header = '';
      rows.forEach((r, idx) => {
        if (/^\|[\s:-]+\|/.test(r.replace(/\s/g, ''))) return;
        const tds = cells(r).map((c) => (idx === 0
          ? '<th style="padding:8px 10px;border:1px solid #dbe4f0;background:#eef4fb;color:#0f2b4c;text-align:left;font-size:13.5px;">' + inline(c) + '</th>'
          : '<td style="padding:8px 10px;border:1px solid #dbe4f0;font-size:13.5px;">' + inline(c) + '</td>')).join('');
        if (idx === 0) header = '<tr>' + tds + '</tr>'; else body += '<tr>' + tds + '</tr>';
      });
      out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">' + header + body + '</table>');
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul style="margin:8px 0 8px 22px;font-size:15px;line-height:1.85;">' + items.map((t) => '<li style="margin:4px 0;">' + inline(t) + '</li>').join('') + '</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol style="margin:8px 0 8px 22px;font-size:15px;line-height:1.85;">' + items.map((t) => '<li style="margin:4px 0;">' + inline(t) + '</li>').join('') + '</ol>');
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join('\n');
}

const md = fs.readFileSync(SRC, 'utf8');
const bodyHtml = render(md);
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>去中心化组织级知识图谱构建</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:'Microsoft YaHei','Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="860" cellpadding="0" cellspacing="0" style="width:860px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 14px rgba(15,36,64,.08);color:#1f2937;line-height:1.75;">
<tr><td style="background:#0f2b4c;background:linear-gradient(135deg,#0f2b4c,#1d4e89);padding:32px 44px;">
<div style="display:inline-block;border:1px solid rgba(255,255,255,.45);border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:1px;color:#dbe8f7;margin-bottom:14px;">技术论文 · 内部参考</div>
<div style="font-size:25px;font-weight:700;color:#ffffff;line-height:1.4;">去中心化组织级知识图谱构建</div>
<div style="font-size:14px;color:#b9cde6;margin-top:10px;">从单项目意图图谱，到联邦式组织知识网络</div>
</td></tr>
<tr><td style="padding:10px 44px 34px;">
${bodyHtml}
<div style="border-top:1px solid #eef1f5;margin-top:22px;padding-top:14px;font-size:12.5px;color:#7a8798;">
本文为高层概念与定位文章，供内部参阅与推敲；文中实测数据来源于底座项目的自测（非第三方独立评测）。
</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('[render] wrote', OUT, '(' + html.length + ' chars)');
