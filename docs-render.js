// 文档的 Markdown 渲染。网页 docs.html 和导出本地副本的 tools/export-docs.cjs 共用这一份，两边显示一样。
// 只支持文档里用到的写法：标题、段落、嵌套列表、表格、引用、代码块、加粗、行内代码、链接。
(function(root){
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const unesc = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const LIST_RE = /^( *)([-*+]|\d{1,3}[.)])[ \t]+(.*)$/;
  const lead = l => l.match(/^ */)[0].length;
  const CJK = /[⺀-鿿豈-﫿＀-￯]/;
  // 中文换行接起来不加空格，英文加一个
  const joinLines = arr => arr.reduce((a, b) => a + (CJK.test(a.slice(-1)) && CJK.test(b[0] || '') ? '' : ' ') + b);

  // 和 GitHub 一样的标题锚点：去掉标点、空格换成 -，重复的加 -1、-2
  function slug(text, used){
    const s = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    let out = s || 'h', n = 1;
    while (used.has(out)) out = s + '-' + (n++);
    used.add(out);
    return out;
  }

  function inline(s, ctx){
    let o = esc(s);
    o = o.replace(/`([^`]+)`/g, '<code>$1</code>');
    o = o.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    o = o.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => link(t, u, ctx));
    o = o.replace(/&lt;(https?:\/\/[^\s<>]+?)&gt;/g, (m, u) => link(u, u, ctx));
    return o;
  }
  // mapLink(原始地址) 返回 {href, ext} 或 null；null 时只显示文字
  function link(text, u, ctx){
    const h = ctx.mapLink(unesc(u));
    if (!h) return text;
    return '<a href="'+esc(h.href)+'"'+(h.ext ? ' target="_blank" rel="noopener"' : '')+'>'+text+'</a>';
  }

  const isTableAt = (lines, i) => /^ *\|/.test(lines[i]) && i + 1 < lines.length && /^ *\|? *:?-{3,}/.test(lines[i+1]);
  function isBlockStart(lines, i){
    const l = lines[i];
    return /^#{1,4} /.test(l) || /^ *```/.test(l) || /^ *(-{3,}|\*{3,}|_{3,}) *$/.test(l) || /^ *>/.test(l) || LIST_RE.test(l) || isTableAt(lines, i);
  }
  function cells(row){
    let s = row.trim();
    if (s[0] === '|') s = s.slice(1);
    if (s.slice(-1) === '|') s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }
  function table(rows, ctx){
    const head = cells(rows[0]), body = rows.slice(2).map(cells);
    return '<div class="tablewrap"><table><thead><tr>'+head.map(c => '<th>'+inline(c, ctx)+'</th>').join('')+'</tr></thead><tbody>'+
      body.map(r => '<tr>'+head.map((_, k) => '<td>'+inline(r[k] || '', ctx)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function list(lines, i, ctx){
    const m0 = lines[i].match(LIST_RE), base = m0[1].length, ordered = /\d/.test(m0[2]);
    const startNo = ordered ? parseInt(m0[2], 10) : 1, items = [];
    while (i < lines.length){
      if (!lines[i].trim()){
        let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        const mj = j < lines.length && lines[j].match(LIST_RE);
        if (mj && mj[1].length === base && /\d/.test(mj[2]) === ordered){ i = j; continue; }
        break;
      }
      const m = lines[i].match(LIST_RE);
      if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
      const cIndent = base + m[2].length + 1, buf = [m[3]];
      i++;
      while (i < lines.length){
        const l = lines[i];
        if (!l.trim()){
          let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && lead(lines[j]) > base){ buf.push(''); i++; continue; }
          break;
        }
        const ld = lead(l);
        if (ld > base){ buf.push(l.slice(Math.min(ld, cIndent))); i++; continue; }
        break;
      }
      items.push(buf);
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = (ordered && startNo !== 1 ? '<ol start="'+startNo+'">' : '<'+tag+'>') +
      items.map(b => '<li>'+(b.slice(1).some(x => x.trim()) ? blocks(b, ctx) : inline(b[0], ctx))+'</li>').join('') + '</'+tag+'>';
    return {html, next:i};
  }
  function blocks(lines, ctx){
    let html = '', i = 0;
    while (i < lines.length){
      const line = lines[i];
      if (!line.trim()){ i++; continue; }
      if (/^ *```/.test(line)){
        const buf = []; i++;
        while (i < lines.length && !/^ *```/.test(lines[i])){ buf.push(lines[i]); i++; }
        i++; html += '<pre><code>'+esc(buf.join('\n'))+'</code></pre>'; continue;
      }
      const hm = line.match(/^(#{1,4}) +(.+?) *#* *$/);
      if (hm){
        const lv = hm[1].length, inner = inline(hm[2], ctx), text = unesc(inner.replace(/<[^>]+>/g, ''));
        const id = slug(text, ctx.used);
        if (lv === 2) ctx.toc.push({id, text});
        if (lv === 1 && !ctx.title) ctx.title = text;
        html += '<h'+lv+' id="'+esc(id)+'">'+inner+'</h'+lv+'>'; i++; continue;
      }
      if (/^ *(-{3,}|\*{3,}|_{3,}) *$/.test(line)){ html += '<hr>'; i++; continue; }
      if (isTableAt(lines, i)){
        const rows = []; while (i < lines.length && /^ *\|/.test(lines[i])){ rows.push(lines[i]); i++; }
        html += table(rows, ctx); continue;
      }
      if (/^ *>/.test(line)){
        const buf = []; while (i < lines.length && /^ *>/.test(lines[i])){ buf.push(lines[i].replace(/^ *> ?/, '')); i++; }
        html += '<blockquote>'+blocks(buf, ctx)+'</blockquote>'; continue;
      }
      if (LIST_RE.test(line)){ const r = list(lines, i, ctx); html += r.html; i = r.next; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines, i))){ buf.push(lines[i].trim()); i++; }
      html += '<p>'+inline(joinLines(buf), ctx)+'</p>';
    }
    return html;
  }

  function render(md, mapLink){
    const ctx = {used:new Set(), toc:[], title:'', mapLink: mapLink || (() => null)};
    const html = blocks(String(md).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), ctx);
    return {html, toc:ctx.toc, title:ctx.title};
  }
  // 目录（二级标题）放在开头介绍之后、第一个二级标题之前
  function withToc(r){
    if (!r.toc.length) return r.html;
    const toc = '<details class="toc" id="toc" open><summary>目录</summary><ul>'+r.toc.map(t => '<li><a href="#'+esc(t.id)+'">'+esc(t.text)+'</a></li>').join('')+'</ul></details>';
    return r.html.replace(/(<\/h1>[\s\S]*?)(<h2|$)/, (m, a, b) => a + toc + b);
  }

  const api = {render, withToc, esc};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BojiDocs = api;
})(typeof self !== 'undefined' ? self : this);
