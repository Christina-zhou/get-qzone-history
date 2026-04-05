'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractCount(text, pattern) {
  const match = String(text || '').match(pattern);
  return Number((match && (match[1] || match[2])) || 0);
}

function extractBestTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const fullMatch = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})(?:\D{0,3}(\d{1,2})\D{0,3}(\d{1,2}))?/);
  if (fullMatch) {
    const [, year, month, day, hour = '0', minute = '0'] = fullMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0).getTime();
  }
  return null;
}

function formatChineseDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

function normalizeRelativeDateText(value, referenceDate = new Date()) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/^(今天|昨天|前天)(\d{1,2}:\d{2})?/);
  if (!match) {
    return text;
  }

  const [, relativeLabel, timePart = ''] = match;
  const date = new Date(referenceDate);
  date.setHours(0, 0, 0, 0);
  if (relativeLabel === '昨天') {
    date.setDate(date.getDate() - 1);
  } else if (relativeLabel === '前天') {
    date.setDate(date.getDate() - 2);
  }

  const absolutePrefix = `${formatChineseDate(date)}${timePart ? ` ${timePart}` : ''}`;
  return `${absolutePrefix}${text.slice(match[0].length)}`.trim();
}

function collectPostImageUrls(post) {
  const localImages = String(post.downloaded_image_paths || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  if (localImages.length) {
    return localImages;
  }
  return String(post.image_urls || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function writeJson(posts, outputPath) {
  fs.writeFileSync(outputPath, `${JSON.stringify(posts, null, 2)}\n`, 'utf8');
}

function writeExcel(posts, outputPath) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(posts);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'posts');
  XLSX.writeFile(workbook, outputPath);
}

function writeViewerHtml(posts, outputPath, targetQq) {
  const viewerPosts = posts.map((post, index) => ({
    ...post,
    _viewer_index: index,
    _created_at_ms: extractBestTimestamp(post.created_time),
    _updated_at_ms: extractBestTimestamp(post.updated_time || post.modified_time || ''),
  }));

  const cards = viewerPosts
    .map((post, index) => {
      const imageMarkup = collectPostImageUrls(post)
        .map(
          (imagePath, imageIndex) => `
            <a class="image-link" href="${escapeHtml(imagePath)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(imagePath)}" alt="image-${index + 1}-${imageIndex + 1}">
            </a>
          `
        )
        .join('\n');

      return `
        <article class="card" data-created-at="${post._created_at_ms || ''}" data-updated-at="${post._updated_at_ms || ''}" data-viewer-index="${post._viewer_index}">
          <div class="card-head">
            <div>
              <div class="meta-index">#${index + 1}</div>
              <h2>${escapeHtml(post.created_time || '未知时间')}</h2>
            </div>
            <div class="meta-right">
              <span>${escapeHtml(post.source_name || '')}</span>
              <span>${escapeHtml(post.tid || '')}</span>
            </div>
          </div>
          <div class="content">${escapeHtml(post.content || '').replace(/\n/g, '<br>')}</div>
          ${imageMarkup ? `<div class="image-grid">${imageMarkup}</div>` : '<div class="no-image">无图片</div>'}
          <div class="card-foot">
            <span>评论 ${escapeHtml(post.comment_count)}</span>
            <span>点赞 ${escapeHtml(post.like_count)}</span>
            <span>图片 ${escapeHtml(post.image_count)}</span>
            ${post.post_url ? `<a href="${escapeHtml(post.post_url)}" target="_blank" rel="noopener noreferrer">打开原说说</a>` : ''}
          </div>
        </article>
      `;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QQ空间说说浏览 - ${escapeHtml(targetQq)}</title>
  <style>
    :root { --bg:#f4efe7; --card:rgba(255,255,255,0.9); --line:rgba(47,43,38,0.12); --text:#2f2b26; --muted:#72695d; --accent:#c85c3c; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Microsoft YaHei","PingFang SC",sans-serif; color:var(--text); background:radial-gradient(circle at top left, rgba(200,92,60,0.18), transparent 26%), linear-gradient(180deg, #f8f3eb 0%, var(--bg) 100%); }
    .wrap { max-width:1080px; margin:0 auto; padding:28px 20px 56px; }
    .hero { position:sticky; top:0; z-index:10; backdrop-filter:blur(12px); background:rgba(244,239,231,0.82); border-bottom:1px solid var(--line); padding:16px 0 14px; margin-bottom:20px; }
    .hero h1 { margin:0 0 6px; font-size:28px; }
    .hero p { margin:0; color:var(--muted); }
    .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin:16px 0 18px; }
    .toolbar label { color:var(--muted); font-size:14px; }
    .toolbar select { border:1px solid var(--line); background:rgba(255,255,255,0.92); border-radius:10px; padding:8px 12px; color:var(--text); }
    .grid { display:grid; gap:18px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:18px; box-shadow:0 18px 40px rgba(90,74,54,0.08); }
    .card-head,.card-foot { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
    .card-head h2 { margin:2px 0 0; font-size:18px; }
    .meta-index,.meta-right,.card-foot,.no-image { color:var(--muted); font-size:13px; }
    .meta-right,.card-foot { display:flex; gap:12px; flex-wrap:wrap; }
    .content { margin:14px 0 16px; line-height:1.75; font-size:15px; white-space:normal; word-break:break-word; }
    .image-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px; }
    .image-link { display:block; border-radius:14px; overflow:hidden; background:#efe4d5; border:1px solid rgba(47,43,38,0.08); min-height:120px; }
    .image-link img { display:block; width:100%; height:100%; object-fit:cover; }
    a { color:var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
    @media (max-width:720px) { .wrap { padding:18px 14px 40px; } .hero h1 { font-size:22px; } .image-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>QQ空间说说浏览</h1>
      <p>QQ号 ${escapeHtml(targetQq)}，共 ${posts.length} 条说说。默认按最新在前显示。</p>
    </section>
    <section class="toolbar">
      <label for="sortSelect">排序方式</label>
      <select id="sortSelect">
        <option value="created_desc">创建时间：新到旧</option>
        <option value="created_asc">创建时间：旧到新</option>
        <option value="updated_desc">修改时间：新到旧</option>
        <option value="updated_asc">修改时间：旧到新</option>
      </select>
    </section>
    <section class="grid">${cards}</section>
  </div>
  <script>
    (function () {
      const select = document.getElementById('sortSelect');
      const grid = document.querySelector('.grid');
      if (!select || !grid) return;

      const sortCards = (mode) => {
        const cards = Array.from(grid.querySelectorAll('.card'));
        cards.sort((a, b) => {
          const createdA = Number(a.dataset.createdAt || 0);
          const createdB = Number(b.dataset.createdAt || 0);
          const updatedA = Number(a.dataset.updatedAt || 0) || createdA;
          const updatedB = Number(b.dataset.updatedAt || 0) || createdB;

          if (mode === 'created_asc') return createdA - createdB;
          if (mode === 'updated_desc') return updatedB - updatedA;
          if (mode === 'updated_asc') return updatedA - updatedB;
          return createdB - createdA;
        });
        for (const card of cards) {
          grid.appendChild(card);
        }
      };

      select.addEventListener('change', () => sortCards(select.value));
      sortCards(select.value);
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    throw new Error('Usage: node repair_export_counts.js <json-file>');
  }

  const jsonPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(process.cwd(), inputArg);
  const basePath = jsonPath.replace(/\.json$/i, '');
  const excelPath = `${basePath}.xlsx`;
  const htmlPath = `${basePath}.html`;

  const posts = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  for (const post of posts) {
    post.created_time = normalizeRelativeDateText(post.created_time || '');
    post.comment_count = extractCount(post.created_time, /评论(?:\((\d+)\)|\s*(\d+))?/);
    const explicitLikeCount = extractCount(post.created_time, /(?:点赞|赞)(?:\((\d+)\)|\s*(\d+))?/);
    if (explicitLikeCount > 0) {
      post.like_count = explicitLikeCount;
    }
  }

  const qq = path.basename(basePath).split('_')[0] || '';
  writeJson(posts, jsonPath);
  writeExcel(posts, excelPath);
  writeViewerHtml(posts, htmlPath, qq);

  console.log(`Repaired counts in ${jsonPath}`);
  console.log(`Updated Excel: ${excelPath}`);
  console.log(`Updated HTML : ${htmlPath}`);
}

main();
