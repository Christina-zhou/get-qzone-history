'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { chromium, request } = require('playwright');
const XLSX = require('xlsx');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const QZONE_HOME_URL = 'https://user.qzone.qq.com';
const MSG_LIST_URL =
  'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6';

function parseArgs(argv) {
  const args = {
    config: 'qzone_history.ini',
    targetQq: '',
    browserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    mobile: false,
    connectCdp: '',
    startPage: 1,
    pageWaitMs: 20000,
    endPage: 0,
    segmentPages: 30,
    segmentPauseMs: 180000,
    checkpoint: '',
    stagnantPageLimit: 8,
    resumeCheckpoint: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--config' && argv[i + 1]) {
      args.config = argv[++i];
    } else if (value === '--target-qq' && argv[i + 1]) {
      args.targetQq = argv[++i].trim();
    } else if (value === '--browser-path' && argv[i + 1]) {
      args.browserPath = argv[++i];
    } else if (value === '--headless') {
      args.headless = true;
    } else if (value === '--mobile') {
      args.mobile = true;
    } else if (value === '--connect-cdp' && argv[i + 1]) {
      args.connectCdp = argv[++i];
    } else if (value === '--start-page' && argv[i + 1]) {
      args.startPage = Number(argv[++i]) || 1;
    } else if (value === '--page-wait-ms' && argv[i + 1]) {
      args.pageWaitMs = Number(argv[++i]) || 20000;
    } else if (value === '--end-page' && argv[i + 1]) {
      args.endPage = Number(argv[++i]) || 0;
    } else if (value === '--segment-pages' && argv[i + 1]) {
      args.segmentPages = Number(argv[++i]) || 30;
    } else if (value === '--segment-pause-ms' && argv[i + 1]) {
      args.segmentPauseMs = Number(argv[++i]) || 180000;
    } else if (value === '--checkpoint' && argv[i + 1]) {
      args.checkpoint = argv[++i];
    } else if (value === '--stagnant-page-limit' && argv[i + 1]) {
      args.stagnantPageLimit = Number(argv[++i]) || 8;
    } else if (value === '--resume-checkpoint' && argv[i + 1]) {
      args.resumeCheckpoint = argv[++i];
    }
  }

  return args;
}

function parseIni(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentSection = '';

  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result[currentSection] = result[currentSection] || {};
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!result[currentSection]) {
      result[currentSection] = {};
    }
    result[currentSection][key] = value;
  }

  return result;
}

function resolveConfig(cliArgs) {
  const scriptDir = __dirname;
  const configPath = path.isAbsolute(cliArgs.config)
    ? cliArgs.config
    : path.join(scriptDir, cliArgs.config);
  const ini = fs.existsSync(configPath) ? parseIni(configPath) : {};

  const tempDir = path.resolve(
    scriptDir,
    ini.paths?.temp_dir || 'resource/temp'
  );
  const resultDir = path.resolve(
    scriptDir,
    ini.paths?.result_dir || 'resource/result'
  );

  return {
    tempDir,
    resultDir,
    loginTimeoutSeconds: Number(ini.login?.login_timeout_seconds || 300),
    pageSize: Number(ini.fetch?.page_size || 20),
    maxPages: Number(ini.fetch?.max_pages || 0),
    targetQq: cliArgs.targetQq,
    browserPath: cliArgs.browserPath,
    headless: cliArgs.headless,
    mobile: cliArgs.mobile,
    connectCdp: cliArgs.connectCdp,
    startPage: cliArgs.startPage,
    pageWaitMs: cliArgs.pageWaitMs,
    endPage: cliArgs.endPage,
    segmentPages: cliArgs.segmentPages,
    segmentPauseMs: cliArgs.segmentPauseMs,
    stagnantPageLimit: cliArgs.stagnantPageLimit,
    checkpoint: cliArgs.checkpoint
      ? path.isAbsolute(cliArgs.checkpoint)
        ? cliArgs.checkpoint
        : path.resolve(scriptDir, cliArgs.checkpoint)
      : '',
    resumeCheckpoint: cliArgs.resumeCheckpoint
      ? path.isAbsolute(cliArgs.resumeCheckpoint)
        ? cliArgs.resumeCheckpoint
        : path.resolve(scriptDir, cliArgs.resumeCheckpoint)
      : '',
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${seconds}秒`;
}

function renderProgressLine(stage, message) {
  return `[${stage}] ${message}`;
}

function updateTerminalProgress(stage, message) {
  const line = renderProgressLine(stage, message);
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K${line}`);
    return;
  }
  console.log(line);
}

function finishTerminalProgress() {
  if (process.stdout.isTTY) {
    process.stdout.write('\n');
  }
}

async function waitWithProgress(waitTarget, totalMs, stage, message) {
  const total = Math.max(0, Number(totalMs) || 0);
  if (!total) {
    return;
  }
  if (!process.stdout.isTTY) {
    await waitTarget.waitForTimeout(total);
    return;
  }

  const stepMs = Math.min(5000, Math.max(1000, Math.floor(total / 10) || 1000));
  let remaining = total;
  while (remaining > 0) {
    updateTerminalProgress(stage, `${message}，剩余约 ${formatDuration(remaining)}`);
    const currentStep = Math.min(stepMs, remaining);
    await waitTarget.waitForTimeout(currentStep);
    remaining -= currentStep;
  }
  finishTerminalProgress();
}

function hash33(value) {
  let result = 5381;
  for (const char of value) {
    result += (result << 5) + char.charCodeAt(0);
  }
  return result & 0x7fffffff;
}

function stripJsonp(payload) {
  const match = payload.trim().match(/\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) {
    throw new Error('Could not parse JSONP payload from response.');
  }
  return JSON.parse(match[1]);
}

function normalizeText(rawValue) {
  if (rawValue == null) {
    return '';
  }
  return String(rawValue)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFileName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeImageUrl(url) {
  const value = decodeHtmlEntities(url).trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('//')) {
    return `https:${value}`;
  }
  if (/^http:\/\/[^/]*photo\.store\.qq\.com/i.test(value)) {
    return value.replace(/^http:\/\//i, 'https://');
  }
  return value;
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
  return String(post?.image_urls || '')
    .split('\n')
    .map((item) => normalizeImageUrl(item))
    .filter(Boolean);
}

function inferImageExtension(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('gif')) return '.gif';
  if (type.includes('webp')) return '.webp';
  if (type.includes('bmp')) return '.bmp';
  if (type.includes('svg')) return '.svg';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext && ext.length <= 6) {
      return ext;
    }
  } catch (error) {
    return '.jpg';
  }
  return '.jpg';
}

function normalizePost(item, targetQq) {
  const createdAt = item.created_time || item.created_time_iso || '';
  let createdTime = '';
  if (createdAt) {
    const timestamp = Number(createdAt);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      createdTime = new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19);
    } else {
      createdTime = String(createdAt);
    }
  }

  const tid = String(item.tid || item.tid64 || '');
  const images = Array.isArray(item.pic) ? item.pic : Array.isArray(item.pic_list) ? item.pic_list : [];
  const imageUrls = images
    .map((image) => {
      if (!image || typeof image !== 'object') {
        return '';
      }
      return image.pic_id || image.url1 || image.url2 || image.url3 || '';
    })
    .filter(Boolean);

  const likeCount =
    item.praise && typeof item.praise === 'object'
      ? item.praise.num || 0
      : item.praise_num || 0;

  return {
    created_time: createdTime,
    tid,
    content: normalizeText(item.content),
    raw_content: item.content || '',
    source_name: normalizeText(item.source_name || item.source || ''),
    app_name: normalizeText(item.name || ''),
    location: normalizeText(item.lbs && typeof item.lbs === 'object' ? item.lbs.name : ''),
    comment_count: item.cmtnum || 0,
    like_count: likeCount,
    image_count: imageUrls.length,
    image_urls: imageUrls.join('\n'),
    post_url: tid ? `${QZONE_HOME_URL}/${targetQq}/mood/${tid}` : '',
    ugc_right: item.ugc_right || '',
    format: item.format || '',
    raw_json: JSON.stringify(item),
  };
}

function normalizeMobilePost(feed, targetQq) {
  const createdTime =
    feed?.comm?.time || feed?.time || feed?.created_time || feed?.publishTime || '';
  const cellId =
    feed?.id?.cellid ||
    feed?.cellid ||
    feed?.id?.busi_param ||
    feed?.current?.cellid ||
    feed?.comm?.feedkey ||
    feed?.comm?.tid ||
    feed?.comm?.curkey ||
    feed?.comm?.curlikekey ||
    feed?.comm?.orglikekey ||
    '';

  const contentCandidates = [
    feed?.content,
    feed?.summary?.summary,
    feed?.summary?.message,
    feed?.current?.summary,
    feed?.current?.content,
    feed?.html_content,
  ];
  const content = normalizeText(contentCandidates.find(Boolean) || '');

  const images =
    feed?.pic &&
    Array.isArray(feed.pic)
      ? feed.pic
      : Array.isArray(feed?.current?.pic)
      ? feed.current.pic
      : Array.isArray(feed?.image_info)
      ? feed.image_info
      : [];
  const imageUrls = images
    .map((image) => {
      if (!image || typeof image !== 'object') {
        return '';
      }
      return (
        image.url ||
        image.pic_id ||
        image.picUrl ||
        image.small_url ||
        image.large_url ||
        image.absolute_position_url ||
        ''
      );
    })
    .filter(Boolean);

  return {
    created_time: String(createdTime),
    tid: String(cellId),
    content,
    raw_content: content,
    source_name: normalizeText(feed?.source || feed?.source_name || ''),
    app_name: normalizeText(feed?.appidname || feed?.appname || ''),
    location: normalizeText(feed?.lbs?.name || feed?.poi?.name || ''),
    comment_count: Number(feed?.comment?.comments || feed?.comment_count || feed?.cmtnum || 0),
    like_count: Number(feed?.like?.num || feed?.praise?.num || feed?.like_count || 0),
    image_count: imageUrls.length,
    image_urls: imageUrls.join('\n'),
    post_url: cellId ? `${QZONE_HOME_URL}/${targetQq}/mood/${cellId}` : '',
    ugc_right: feed?.ugc_right || '',
    format: feed?.type || feed?.format || 'mobile_feed',
    raw_json: JSON.stringify(feed),
  };
}

function normalizeMobileDomPost(post, targetQq) {
  const tid = String(post?.tid || post?.cellid || post?.id || '');
  const content = normalizeText(post?.content || post?.text || post?.summary || '');
  const imageUrls = Array.isArray(post?.images) ? post.images.filter(Boolean) : [];
  return {
    created_time: String(post?.created_time || post?.time || ''),
    tid,
    content,
    raw_content: content,
    source_name: normalizeText(post?.source_name || post?.source || ''),
    app_name: normalizeText(post?.app_name || post?.app || ''),
    location: normalizeText(post?.location || ''),
    comment_count: Number(post?.comment_count || 0),
    like_count: Number(post?.like_count || 0),
    image_count: imageUrls.length,
    image_urls: imageUrls.join('\n'),
    post_url: tid ? `${QZONE_HOME_URL}/${targetQq}/mood/${tid}` : '',
    ugc_right: post?.ugc_right || '',
    format: post?.format || 'mobile_dom',
    raw_json: JSON.stringify(post),
  };
}

function normalizeDesktopPost(post, targetQq) {
  const tid = String(post?.tid || '');
  const imageUrls = Array.isArray(post?.images) ? post.images.filter(Boolean) : [];
  return {
    created_time: normalizeRelativeDateText(post?.created_time || ''),
    tid,
    content: normalizeText(post?.content || ''),
    raw_content: normalizeText(post?.content || ''),
    source_name: normalizeText(post?.source_name || ''),
    app_name: normalizeText(post?.app_name || ''),
    location: normalizeText(post?.location || ''),
    comment_count: Number(post?.comment_count || 0),
    like_count: Number(post?.like_count || 0),
    image_count: imageUrls.length,
    image_urls: imageUrls.join('\n'),
    post_url: tid ? `${QZONE_HOME_URL}/${targetQq}/mood/${tid}` : '',
    ugc_right: post?.ugc_right || '',
    format: 'desktop_dom',
    raw_json: JSON.stringify(post),
  };
}

function dedupePosts(posts) {
  const seen = new Set();
  const result = [];
  for (const post of posts) {
    const key = post.tid || `${post.created_time}|${post.content}|${post.raw_json || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(post);
    }
  }
  result.sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
  return result;
}

async function openDesktopMoodFrame(page, targetQq) {
  await page.goto(`${QZONE_HOME_URL}/${targetQq}/311`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(3000);
  const frame =
    page.frame({ name: 'app_canvas_frame' }) ||
    page.frames().find((item) => item.url().includes('mood_v6/html/index.html'));
  if (!frame) {
    throw new Error('Desktop Qzone mood iframe was not found.');
  }
  await frame.waitForLoadState('domcontentloaded').catch(() => {});
  await frame.waitForTimeout(2000);
  return frame;
}

async function expandDesktopPosts(frame) {
  const selectors = ['.f_toggle', '.rt_has_more_con', '.md_unfold', 'a', 'span', 'button'];
  for (let round = 0; round < 3; round += 1) {
    let clicked = 0;
    for (const selector of selectors) {
      const locator = ['a', 'span', 'button'].includes(selector)
        ? frame.locator(selector).filter({ hasText: /全文|展开|更多/ })
        : frame.locator(selector);
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        try {
          if (await item.isVisible({ timeout: 500 })) {
            await item.click({ timeout: 1000 });
            clicked += 1;
            await frame.waitForTimeout(180);
          }
        } catch (error) {
          continue;
        }
      }
    }
    if (!clicked) {
      break;
    }
  }
}

async function prepareDesktopPageForExtraction(frame, pageWaitMs) {
  const settleMs = Math.max(3000, Math.min(pageWaitMs, 8000));
  const stepPauseMs = Math.max(800, Math.min(Math.floor(pageWaitMs / 8), 2500));

  await waitWithProgress(frame, settleMs, '抓取', '等待页面基础内容稳定');
  await frame.evaluate(async (pauseMs) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const root = document.scrollingElement || document.documentElement || document.body;
    const maxScroll = Math.max(
      root ? root.scrollHeight - window.innerHeight : 0,
      document.body ? document.body.scrollHeight - window.innerHeight : 0
    );
    const checkpoints = [0, 0.25, 0.5, 0.8, 1, 0.6, 0.2, 1];
    for (const ratio of checkpoints) {
      const top = Math.max(0, Math.floor(maxScroll * ratio));
      window.scrollTo({ top, behavior: 'instant' });
      await sleep(pauseMs);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(pauseMs);
  }, stepPauseMs);

  await expandDesktopPosts(frame);
  await waitWithProgress(
    frame,
    Math.max(1500, Math.min(Math.floor(pageWaitMs / 3), 6000)),
    '抓取',
    '等待展开后的内容加载完成'
  );
}

async function extractDesktopPostsFromFrame(frame, targetQq) {
  await expandDesktopPosts(frame);
  const rawPosts = await frame.evaluate(() => {
    const text = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const shouldKeepImage = (img, url) => {
      if (!url) {
        return false;
      }
      const lowerUrl = url.toLowerCase();
      if (
        lowerUrl.includes('qlogo.cn') ||
        lowerUrl.includes('/qzone/em/') ||
        lowerUrl.includes('emotion') ||
        lowerUrl.includes('avatar') ||
        lowerUrl.includes('noface')
      ) {
        return false;
      }

      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width > 0 && height > 0 && (width < 80 || height < 80)) {
        return false;
      }
      return true;
    };
    const boxes = Array.from(document.querySelectorAll('.feed_wrap .box.bgr3'));
    return boxes.map((box) => {
      const dropdown = box.querySelector('.dropdown-trigger[id^="dLabel_"]');
      const dropdownId = dropdown ? dropdown.id : '';
      const tidFromDropdown = dropdownId ? dropdownId.replace(/^dLabel_/, '') : '';
      const detailLink =
        box.querySelector('a[href*="/mood/"]') ||
        box.querySelector('a[data-clicklog*="mood"]');
      const tidFromLink =
        detailLink && detailLink.getAttribute('href')
          ? (detailLink.getAttribute('href').match(/\/mood\/([^/?#]+)/) || [])[1] || ''
          : '';
      const tid = tidFromDropdown || tidFromLink;

      const userNode = box.querySelector('.bd .user-name, .bd .f-name, .bd .nickname, .hd .name');
      const sourceNode = box.querySelector('.ft .info, .ft .from, .ft');
      const contentNode =
        box.querySelector('.content, .txt-box, .txt, .bd pre, .bd .mood_cont, .bd .con');
      const commentsNode = box.querySelector('.comments_list');
      const locationNode = box.querySelector('.place, .location, [data-loc]');
      const imageContainers = [
        '.pic',
        '.media_box',
        '.img-box',
        '.mood_pic',
        '.picbox',
        '.gallery',
      ];
      const imageElements = [];
      for (const selector of imageContainers) {
        for (const node of Array.from(box.querySelectorAll(`${selector} img`))) {
          if (!imageElements.includes(node)) {
            imageElements.push(node);
          }
        }
      }
      if (!imageElements.length) {
        for (const node of Array.from(box.querySelectorAll('.bd img'))) {
          if (!imageElements.includes(node)) {
            imageElements.push(node);
          }
        }
      }
      const imageNodes = imageElements
        .map((img) => {
          const url = img.getAttribute('src') || '';
          return shouldKeepImage(img, url) ? url : '';
        })
        .filter(Boolean);

      const footerText = text(sourceNode ? sourceNode.innerText : '');
      const extractCount = (pattern) => {
        const match = footerText.match(pattern);
        return Number((match && (match[1] || match[2])) || 0);
      };
      const commentCount = extractCount(/评论(?:\((\d+)\)|\s*(\d+))?/);
      const likeCount =
        extractCount(/(?:点赞|赞)(?:\((\d+)\)|\s*(\d+))?/) ||
        extractCount(/转发(?:\((\d+)\)|\s*(\d+))?/);
      const content = text(contentNode ? contentNode.innerText : box.innerText);
      const hasExpand =
        Boolean(box.querySelector('.f_toggle, .rt_has_more_con, .md_unfold')) ||
        /全文|展开|更多/.test(text(box.innerText));

      return {
        tid,
        content,
        created_time: footerText,
        source_name: text(userNode ? userNode.innerText : ''),
        app_name: '',
        location: text(locationNode ? locationNode.innerText : ''),
        comment_count: commentCount,
        like_count: likeCount,
        images: imageNodes.filter(Boolean),
        has_expand: hasExpand,
        extra_comments: text(commentsNode ? commentsNode.innerText : ''),
      };
    });
  });

  return rawPosts
    .map((item) => normalizeDesktopPost(item, targetQq))
    .filter((item) => item.tid || item.content);
}

async function goToNextDesktopPage(frame) {
  const nextByText = frame.locator('a, span, button').filter({ hasText: /下一页/ });
  const pager =
    (await nextByText.count()) > 0
      ? nextByText.last()
      : frame
          .locator('#pager_next_0, .mod_pagenav_main .bt_next, .mod_pagenav .bt_next, .mod_pagenav_main a.next, .mod_pagenav a.next')
          .first();
  if ((await pager.count()) === 0) {
    return false;
  }
  try {
    const className = (await pager.getAttribute('class')) || '';
    if (/disable|disabled|none/.test(className)) {
      return false;
    }
  } catch (error) {
    return false;
  }
  try {
    await pager.click({ timeout: 3000 });
  } catch (error) {
    const handle = await pager.elementHandle();
    if (!handle) {
      return false;
    }
    await frame.evaluate((element) => element.click(), handle);
  }
  await frame.waitForTimeout(2500);
  return true;
}

async function jumpToDesktopPage(frame, pageNumber, pageWaitMs) {
  if (pageNumber <= 1) {
    return;
  }
  const input = frame.locator('#pager_go_0');
  const button = frame.locator('#pager_gobtn_0');
  if ((await input.count()) === 0 || (await button.count()) === 0) {
    throw new Error('Desktop pager jump controls were not found.');
  }
  await input.fill(String(pageNumber));
  await button.click({ timeout: 3000 });
  await frame.waitForTimeout(pageWaitMs);
}

async function fetchPostsViaDesktopDom(page, targetQq, options) {
  const {
    maxPages,
    startPage,
    pageWaitMs,
    endPage,
    segmentPages,
    segmentPauseMs,
    stagnantPageLimit,
    onCheckpoint,
    seedPosts,
  } = options;
  const frame = await openDesktopMoodFrame(page, targetQq);
  await jumpToDesktopPage(frame, startPage, pageWaitMs);
  const posts = Array.isArray(seedPosts) ? [...seedPosts] : [];
  const computedLimit = maxPages > 0 ? maxPages : 500;
  const pageLimit =
    endPage > 0 ? Math.min(computedLimit, Math.max(startPage, endPage)) : computedLimit;
  let pageIndex = Math.max(1, startPage) - 1;
  let pagesInSegment = 0;
  let stagnantPages = 0;
  let previousUniqueCount = dedupePosts(posts).length;

  while (pageIndex < pageLimit) {
    await prepareDesktopPageForExtraction(frame, pageWaitMs);
    const pagePosts = await extractDesktopPostsFromFrame(frame, targetQq);
    posts.push(...pagePosts);
    pageIndex += 1;
    pagesInSegment += 1;
    const dedupedSoFar = dedupePosts(posts);
    console.log(`Desktop page ${pageIndex} parsed, unique posts so far: ${dedupedSoFar.length}`);

    if (dedupedSoFar.length > previousUniqueCount) {
      previousUniqueCount = dedupedSoFar.length;
      stagnantPages = 0;
    } else {
      stagnantPages += 1;
      console.log(
        `Unique post count did not increase on page ${pageIndex}. Stagnant pages: ${stagnantPages}/${stagnantPageLimit}`
      );
    }

    if (typeof onCheckpoint === 'function') {
      await onCheckpoint({
        posts: dedupedSoFar,
        lastPage: pageIndex,
        isFinal: false,
      });
    }

    if (stagnantPageLimit > 0 && stagnantPages >= stagnantPageLimit) {
      console.log(
        `Stopping desktop pagination because unique post count has not increased for ${stagnantPages} consecutive pages.`
      );
      break;
    }

    const reachedLastPage = pageIndex >= pageLimit;
    const reachedSegmentBoundary = segmentPages > 0 && pagesInSegment >= segmentPages;
    if (reachedLastPage) {
      break;
    }
    if (reachedSegmentBoundary) {
      pagesInSegment = 0;
      if (segmentPauseMs > 0) {
        console.log(
          `Segment completed at page ${pageIndex}. Pausing ${segmentPauseMs} ms before continuing.`
        );
        await waitWithProgress(frame, segmentPauseMs, '暂停', `当前已抓到第 ${pageIndex} 页，分段暂停中`);
      }
    }

    let moved = false;
    try {
      moved = await goToNextDesktopPage(frame);
    } catch (error) {
      console.log(`Desktop pagination stopped at page ${pageIndex}. Keeping partial data. Error: ${String(error)}`);
      break;
    }
    if (!moved) {
      break;
    }
  }

  const deduped = dedupePosts(posts);
  if (!deduped.length) {
    throw new Error('No posts could be extracted from the desktop Qzone iframe.');
  }
  if (typeof onCheckpoint === 'function') {
    await onCheckpoint({
      posts: deduped,
      lastPage: pageIndex,
      isFinal: true,
    });
  }
  return deduped;
}

async function waitForLogin(context, page, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies([QZONE_HOME_URL]);
    const uinCookie = cookies.find((cookie) => cookie.name === 'uin');
    const pSkeyCookie = cookies.find((cookie) => cookie.name === 'p_skey' || cookie.name === 'skey');
    if (uinCookie && pSkeyCookie) {
      const currentUrl = page.url();
      const qq = String(uinCookie.value || '').replace(/^o/, '');
      if (qq) {
        return {
          qq,
          cookies,
          currentUrl,
        };
      }
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Timed out while waiting for QQ login confirmation.');
}

async function waitForMobileLogin(context, page, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies([
      'https://mobile.qzone.qq.com',
      'https://h5.qzone.qq.com',
      QZONE_HOME_URL,
    ]);
    const uinCookie = cookies.find((cookie) => cookie.name === 'uin');
    const skeyCookie = cookies.find((cookie) => cookie.name === 'p_skey' || cookie.name === 'skey');
    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const loggedIn =
      uinCookie &&
      skeyCookie &&
      !url.includes('ptlogin2.qq.com') &&
      !url.includes('/cgi-bin/login') &&
      !bodyText.includes('请先登录');
    if (loggedIn) {
      const qq = String(uinCookie.value || '').replace(/^o/, '');
      if (qq) {
        return {
          qq,
          cookies,
          currentUrl: url,
        };
      }
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Timed out while waiting for mobile QQ login confirmation.');
}

async function ensureMobileAuthenticated(page, targetQq, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await page.goto(`https://user.qzone.qq.com/${targetQq}/311`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (!bodyText.includes('请先登录')) {
      return;
    }
    console.log('Mobile Qzone still needs manual login. Complete the login in the opened browser, then wait...');
    await page.waitForTimeout(5000);
  }
  throw new Error('Mobile Qzone authentication did not complete in time.');
}

async function openMobileMoodPage(page, targetQq) {
  try {
    await page.goto(`https://user.qzone.qq.com/${targetQq}/311`, {
      waitUntil: 'commit',
      timeout: 60000,
    });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) {
      throw error;
    }
  }
  await page.waitForURL(/mobile\.qzone\.qq\.com|user\.qzone\.qq\.com/, {
    timeout: 60000,
  }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(3000);
}

async function prepareConnectedPage(context, mobileMode) {
  const page = await context.newPage();
  if (!mobileMode) {
    return page;
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.enable');
  await cdpSession.send('Network.setUserAgentOverride', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
  });
  await cdpSession.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  return page;
}

async function fetchPostsViaMobilePage(page, targetQq, timeoutSeconds) {
  const collected = [];
  const seenBodies = new Set();
  let lastResponseAt = Date.now();

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('mobile.qzone.qq.com/list?format=json') || !url.includes('list_type=shuoshuo')) {
      return;
    }
    try {
      const body = await response.text();
      if (seenBodies.has(body)) {
        return;
      }
      seenBodies.add(body);
      lastResponseAt = Date.now();
      collected.push({
        url,
        status: response.status(),
        body,
      });
      console.log(`Captured mobile list response: ${response.status()} ${url}`);
    } catch (error) {
      console.log(`Failed reading mobile list response: ${String(error)}`);
    }
  });

  try {
    await page.goto(`https://user.qzone.qq.com/${targetQq}/311`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) {
      throw error;
    }
  }
  await page.waitForTimeout(3000);
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('请先登录')) {
    throw new Error(
      'Mobile Qzone still reports "please log in". A real mobile-Qzone login session is required for the /list API.'
    );
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let idleRounds = 0;
  while (Date.now() < deadline) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);

    const noNewResponseFor = Date.now() - lastResponseAt;
    if (collected.length > 0 && noNewResponseFor > 5000) {
      idleRounds += 1;
    } else {
      idleRounds = 0;
    }

    if (idleRounds >= 3) {
      break;
    }
  }

  if (!collected.length) {
    throw new Error('Mobile Qzone page did not emit any shuoshuo list responses.');
  }

  const appendFeeds = (payload, posts) => {
    const feeds = Array.isArray(payload?.data?.vFeeds) ? payload.data.vFeeds : [];
    for (const feed of feeds) {
      posts.push(normalizeMobilePost(feed, targetQq));
    }
  };

  const firstEntry = collected[0];
  let firstPayload;
  try {
    firstPayload = JSON.parse(firstEntry.body);
  } catch (error) {
    throw new Error('Failed to parse initial mobile list payload.');
  }
  if (Number(firstPayload.code) !== 0) {
    throw new Error(
      `Mobile Qzone API returned code=${firstPayload.code}, message=${firstPayload.message || ''}`
    );
  }

  const posts = [];
  appendFeeds(firstPayload, posts);

  const firstUrl = new URL(firstEntry.url);
  const gTk = firstUrl.searchParams.get('g_tk') || '';
  let attachInfo = firstPayload?.data?.attach_info || '';
  let hasMore = Number(firstPayload?.data?.has_more || 0) === 1;
  let pageCount = 1;
  const maxPages = 1000;

  while (hasMore && attachInfo && pageCount < maxPages) {
    const nextPayloadText = await page.evaluate(
      async ({ targetQqValue, gTkValue, attachInfoValue }) => {
        const params = new URLSearchParams({
          g_tk: gTkValue,
          format: 'json',
          list_type: 'shuoshuo',
          action: '0',
          res_uin: targetQqValue,
          count: '10',
          attach_info: attachInfoValue,
        });
        const response = await fetch(`https://mobile.qzone.qq.com/list?${params.toString()}`, {
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
          },
        });
        return JSON.stringify({
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        });
      },
      {
        targetQqValue: targetQq,
        gTkValue: gTk,
        attachInfoValue: attachInfo,
      }
    );

    const nextResponse = JSON.parse(nextPayloadText);
    if (!nextResponse.ok) {
      throw new Error(
        `Mobile Qzone pagination request failed with status ${nextResponse.status}: ${nextResponse.text}`
      );
    }

    const payload = JSON.parse(nextResponse.text);
    if (Number(payload.code) !== 0) {
      throw new Error(
        `Mobile Qzone pagination returned code=${payload.code}, message=${payload.message || ''}`
      );
    }

    appendFeeds(payload, posts);
    attachInfo = payload?.data?.attach_info || '';
    hasMore = Number(payload?.data?.has_more || 0) === 1;
    pageCount += 1;
    console.log(`Fetched mobile page ${pageCount}, unique posts so far: ${dedupePosts(posts).length}`);
    await page.waitForTimeout(300);
  }

  return dedupePosts(posts);
}

async function fetchPostsViaMobileApiPagination(page, targetQq) {
  await openMobileMoodPage(page, targetQq);

  const appendFeeds = (payload, posts) => {
    const feeds = Array.isArray(payload?.data?.vFeeds) ? payload.data.vFeeds : [];
    for (const feed of feeds) {
      posts.push(normalizeMobilePost(feed, targetQq));
    }
  };

  const cookies = await page.context().cookies([
    'https://mobile.qzone.qq.com',
    'https://user.qzone.qq.com',
  ]);
  const cookieMap = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const pSkey = cookieMap.get('p_skey') || cookieMap.get('skey') || '';
  const gTk = String(hash33(pSkey));
  if (!pSkey || !gTk) {
    throw new Error('Failed to compute g_tk for mobile Qzone pagination.');
  }

  const fetchPayload = async (attachInfoValue) => {
    const payloadText = await page.evaluate(
      async ({ targetQqValue, gTkValue, attachInfoArg }) => {
        const params = new URLSearchParams({
          g_tk: gTkValue,
          format: 'json',
          list_type: 'shuoshuo',
          action: '0',
          res_uin: targetQqValue,
          count: '10',
        });
        if (attachInfoArg) {
          params.set('attach_info', attachInfoArg);
        }
        const response = await fetch(`https://mobile.qzone.qq.com/list?${params.toString()}`, {
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
          },
        });
        return JSON.stringify({
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        });
      },
      {
        targetQqValue: targetQq,
        gTkValue: gTk,
        attachInfoArg: attachInfoValue,
      }
    );

    const response = JSON.parse(payloadText);
    if (!response.ok) {
      throw new Error(
        `Mobile Qzone request failed with status ${response.status}: ${response.text}`
      );
    }
    const payload = JSON.parse(response.text);
    if (Number(payload.code) !== 0) {
      throw new Error(
        `Mobile Qzone returned code=${payload.code}, message=${payload.message || ''}`
      );
    }
    return payload;
  };

  const posts = [];
  const firstPayload = await fetchPayload('');
  appendFeeds(firstPayload, posts);

  let attachInfo = firstPayload?.data?.attach_info || '';
  let hasMore = Number(firstPayload?.data?.has_more || 0) === 1;
  let pageCount = 1;
  const maxPages = 1000;

  while (hasMore && attachInfo && pageCount < maxPages) {
    try {
      const payload = await fetchPayload(attachInfo);
      appendFeeds(payload, posts);
      attachInfo = payload?.data?.attach_info || '';
      hasMore = Number(payload?.data?.has_more || 0) === 1;
      pageCount += 1;
      console.log(`Fetched mobile page ${pageCount}, unique posts so far: ${dedupePosts(posts).length}`);
      await page.waitForTimeout(300);
    } catch (error) {
      console.log(
        `Mobile pagination stopped at page ${pageCount + 1}. Keeping partial data. Error: ${String(error)}`
      );
      break;
    }
  }

  return dedupePosts(posts);
}

async function fetchPostsFromMobileDom(page, targetQq, timeoutSeconds) {
  await openMobileMoodPage(page, targetQq);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let stableRounds = 0;
  let previousHeight = -1;
  while (Date.now() < deadline) {
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('请先登录')) {
      throw new Error(
        'Mobile Qzone still reports "please log in". A real mobile-Qzone login session is required.'
      );
    }

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    if (currentHeight === previousHeight) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousHeight = currentHeight;
    }
    if (stableRounds >= 3) {
      break;
    }
  }

  const extracted = await page.evaluate(() => {
    const text = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const attr = (node, name) => (node && node.getAttribute ? node.getAttribute(name) || '' : '');
    const findText = (root, selectors) => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (node && text(node.innerText)) {
          return text(node.innerText);
        }
      }
      return '';
    };
    const findImages = (root) =>
      Array.from(root.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || '')
        .filter(Boolean);

    const scriptPayloads = [];
    for (const script of Array.from(document.scripts)) {
      const content = script.textContent || '';
      if (!content) {
        continue;
      }
      if (content.includes('vFeeds') || content.includes('shuoshuo') || content.includes('cellid')) {
        scriptPayloads.push(content.slice(0, 200000));
      }
    }

    const windowSnapshots = {};
    for (const key of Object.keys(window)) {
      if (!/feed|mood|list|data|state/i.test(key)) {
        continue;
      }
      try {
        const value = window[key];
        if (value && typeof value === 'object') {
          const json = JSON.stringify(value);
          if (json && json.length < 500000) {
            windowSnapshots[key] = json;
          }
        }
      } catch (error) {
        continue;
      }
    }

    const containerSelectors = [
      '.feed',
      '.f-single',
      '.item',
      'li[data-type]',
      '[data-cellid]',
      '.mood-item',
      '.list-item',
      'article',
    ];
    const containers = [];
    for (const selector of containerSelectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!containers.includes(node)) {
          containers.push(node);
        }
      }
    }

    const domPosts = containers
      .map((node) => {
        const cellid =
          attr(node, 'data-cellid') ||
          attr(node, 'data-tid') ||
          attr(node, 'tid') ||
          attr(node, 'data-topic-id');
        const content = findText(node, [
          '.text',
          '.content',
          '.txt',
          '.bd',
          '.msg',
          '.mood-content',
          '.item-pre',
          '.shuoshuo-content',
        ]);
        const createdTime = findText(node, [
          '.time',
          '.c_tx3',
          '.info',
          '.meta',
          '.op-time',
          'time',
        ]);
        if (!content && !cellid) {
          return null;
        }
        return {
          tid: cellid,
          content,
          created_time: createdTime,
          source_name: findText(node, ['.source', '.from', '.device']),
          app_name: '',
          location: findText(node, ['.location', '.locate', '.place']),
          comment_count: 0,
          like_count: 0,
          images: findImages(node),
          format: 'mobile_dom',
        };
      })
      .filter(Boolean);

    return {
      domPosts,
      html: document.documentElement.outerHTML.slice(0, 1000000),
      bodyText: document.body.innerText.slice(0, 200000),
      scriptPayloads,
      windowSnapshots,
    };
  });

  const posts = extracted.domPosts.map((post) => normalizeMobileDomPost(post, targetQq));

  const rawSources = [
    extracted.html,
    extracted.bodyText,
    ...extracted.scriptPayloads,
    ...Object.values(extracted.windowSnapshots),
  ];
  for (const raw of rawSources) {
    for (const candidate of extractPostsFromRawText(raw, targetQq)) {
      posts.push(candidate);
    }
  }

  const deduped = dedupePosts(posts);
  if (!deduped.length) {
    throw new Error('No posts could be extracted from mobile page DOM or embedded data.');
  }
  return deduped;
}

function extractPostsFromRawText(raw, targetQq) {
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  const results = [];
  const feedArrayMatches = raw.match(/"vFeeds"\s*:\s*\[(.*?)\](?=,\s*"[A-Za-z_]+":|})/gs) || [];
  for (const match of feedArrayMatches) {
    const jsonText = `{${match}}`;
    try {
      const payload = JSON.parse(jsonText);
      const feeds = Array.isArray(payload.vFeeds) ? payload.vFeeds : [];
      for (const feed of feeds) {
        results.push(normalizeMobilePost(feed, targetQq));
      }
    } catch (error) {
      continue;
    }
  }

  const cellIdRegex = /"cellid"\s*:\s*"([^"]+)"/g;
  let cellMatch;
  while ((cellMatch = cellIdRegex.exec(raw)) !== null) {
    const cellid = cellMatch[1];
    const windowStart = Math.max(0, cellMatch.index - 2000);
    const windowEnd = Math.min(raw.length, cellMatch.index + 8000);
    const chunk = raw.slice(windowStart, windowEnd);
    const contentMatch =
      chunk.match(/"content"\s*:\s*"((?:\\.|[^"])*)"/) ||
      chunk.match(/"summary"\s*:\s*"((?:\\.|[^"])*)"/) ||
      chunk.match(/"con"\s*:\s*"((?:\\.|[^"])*)"/);
    const timeMatch =
      chunk.match(/"time"\s*:\s*"((?:\\.|[^"])*)"/) ||
      chunk.match(/"created_time"\s*:\s*"((?:\\.|[^"])*)"/);
    if (!contentMatch) {
      continue;
    }
    const content = normalizeText(
      contentMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\')
    );
    results.push(
      normalizeMobileDomPost(
        {
          tid: cellid,
          content,
          created_time: timeMatch ? timeMatch[1] : '',
          format: 'mobile_embedded',
        },
        targetQq
      )
    );
  }

  return results;
}

async function fetchPostsInBrowser(apiContext, targetQq, pageSize, maxPages, gTk) {
  const seen = new Set();
  const posts = [];
  let pos = 0;
  let pageIndex = 0;

  while (true) {
    if (maxPages > 0 && pageIndex >= maxPages) {
      break;
    }

    let payload;
    let retryCount = 0;
    while (true) {
      const params = new URLSearchParams({
        uin: targetQq,
        hostUin: targetQq,
        ftype: '0',
        sort: '0',
        pos: String(pos),
        num: String(pageSize),
        replynum: '100',
        g_tk: String(gTk),
        callback: '_preloadCallback',
        code_version: '1',
        format: 'jsonp',
        need_private_comment: '1',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
      });
      const response = await apiContext.get(`${MSG_LIST_URL}?${params.toString()}`, {
        timeout: 30000,
      });
      if (!response) {
        throw new Error('Qzone API request returned no response.');
      }
      const responseText = await response.text();
      if (!response.ok()) {
        if (response.status() === 501 && responseText.includes('waf.tencent.com/501page.html')) {
          throw new Error(
            'Tencent WAF blocked the history API request from this environment. ' +
              'The real Qzone shuoshuo page is also receiving the same 501 response.'
          );
        }
        throw new Error(
          `Qzone API request failed with status ${response.status()}: ${responseText}`
        );
      }

      payload = stripJsonp(responseText);
      if (['', 'succ', '获取成功', undefined, null].includes(payload.message)) {
        break;
      }

      if (String(payload.message).includes('浣跨敤浜烘暟杩囧') && retryCount < 5) {
        retryCount += 1;
        await new Promise((resolve) => setTimeout(resolve, retryCount * 4000));
        continue;
      }
      throw new Error(`Qzone API returned an error: ${payload.message}`);
    }

    const items = Array.isArray(payload.msglist) ? payload.msglist : [];
    if (!items.length) {
      break;
    }

    for (const item of items) {
      const normalized = normalizePost(item, targetQq);
      if (normalized.tid && !seen.has(normalized.tid)) {
        seen.add(normalized.tid);
        posts.push(normalized);
      }
    }

    pos += items.length;
    pageIndex += 1;

    if (items.length < pageSize) {
      break;
    }
    if (payload.total && pos >= Number(payload.total)) {
      break;
    }
  }

  posts.sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
  return posts;
}

function writeJson(posts, outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(posts, null, 2), 'utf8');
}

function writeExcel(posts, outputPath) {
  const sheet = XLSX.utils.json_to_sheet(posts);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'posts');
  XLSX.writeFile(workbook, outputPath);
}

function writeCheckpoint(posts, outputPath, metadata) {
  const payload = {
    updated_at: new Date().toISOString(),
    total_posts: posts.length,
    ...metadata,
    posts,
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function createDownloadContext(context) {
  const options = {
    extraHTTPHeaders: {
      'User-Agent': USER_AGENT,
      Referer: `${QZONE_HOME_URL}/`,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  };
  if (context) {
    options.storageState = await context.storageState();
  }
  return request.newContext(options);
}

function loadCheckpoint(checkpointPath) {
  const payload = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  if (!Array.isArray(payload.posts)) {
    throw new Error(`Checkpoint does not contain a valid posts array: ${checkpointPath}`);
  }
  return {
    payload,
    posts: payload.posts,
    qq: String(payload.qq || ''),
    baseName: path.basename(checkpointPath).replace(/\.checkpoint\.json$/i, ''),
  };
}

function isBrowserClosedError(error) {
  const message = String(error && (error.stack || error.message || error) || '');
  return /Target page, context or browser has been closed|Browser has been closed|Execution context was destroyed/i.test(
    message
  );
}

async function downloadImageViaBrowserPage(page, imageUrl) {
  if (!page) {
    return null;
  }
  const payload = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      credentials: 'include',
      mode: 'cors',
    });
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader failed.'));
      reader.readAsDataURL(blob);
    });
    return {
      ok: response.ok,
      status: response.status,
      contentType: blob.type || response.headers.get('content-type') || '',
      dataUrl,
    };
  }, imageUrl);

  if (!payload || !payload.ok || !payload.dataUrl) {
    const status = payload ? payload.status : 'unknown';
    throw new Error(`browser fetch failed with status ${status}`);
  }

  const base64 = String(payload.dataUrl).split(',')[1] || '';
  if (!base64) {
    throw new Error('browser fetch returned empty base64 payload');
  }
  return {
    contentType: payload.contentType || '',
    buffer: Buffer.from(base64, 'base64'),
  };
}

async function downloadImageViaBrowserNavigation(page, imageUrl) {
  if (!page) {
    return null;
  }
  const response = await page.goto(imageUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  if (!response || !response.ok()) {
    throw new Error(`browser navigation failed with status ${response ? response.status() : 'unknown'}`);
  }
  return {
    contentType: response.headers()['content-type'] || '',
    buffer: await response.body(),
  };
}

function extractBestTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const fullMatch = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})(?:\D{0,3}(\d{1,2})\D{0,3}(\d{1,2}))?/);
  if (fullMatch) {
    const [, year, month, day, hour = '0', minute = '0'] = fullMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0
    ).getTime();
  }
  const timeOnlyMatch = text.match(/(^|\D)(\d{1,2})\:(\d{2})(\D|$)/);
  if (timeOnlyMatch) {
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(timeOnlyMatch[2]),
      Number(timeOnlyMatch[3]),
      0
    ).getTime();
  }
  return null;
}

function enrichPostsForViewer(posts) {
  return posts.map((post, index) => {
    const createdAtMs = extractBestTimestamp(post.created_time);
    const updatedAtMs = extractBestTimestamp(post.updated_time || post.modified_time || '');
    return {
      ...post,
      _viewer_index: index,
      _created_at_ms: Number.isFinite(createdAtMs) ? createdAtMs : null,
      _updated_at_ms: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
    };
  });
}

async function downloadImagesForPosts(posts, resultDir, baseName, context, page) {
  const imageDirName = `${baseName}_assets`;
  const imageDir = path.join(resultDir, imageDirName, 'images');
  ensureDir(imageDir);

  const apiContext = await createDownloadContext(context);
  const cache = new Map();
  let totalDownloaded = 0;
  let processedImages = 0;
  const totalImages = posts.reduce((sum, post) => sum + collectPostImageUrls(post).length, 0);
  const navigationPage = context ? await context.newPage() : null;

  try {
    for (let postIndex = 0; postIndex < posts.length; postIndex += 1) {
      const post = posts[postIndex];
      const urls = collectPostImageUrls(post);
      const localPaths = [];
      const downloadErrors = [];

      if (urls.length) {
        console.log(
          `Downloading images for post ${postIndex + 1}/${posts.length}, url count: ${urls.length}`
        );
        if (process.stdout.isTTY) {
          updateTerminalProgress(
            '图片',
            `正在处理第 ${postIndex + 1}/${posts.length} 条说说，已下载 ${totalDownloaded} 张，待处理总图数 ${processedImages}/${totalImages}`
          );
        }
      }

      for (let imageIndex = 0; imageIndex < urls.length; imageIndex += 1) {
        const originalUrl = urls[imageIndex];
        if (cache.has(originalUrl)) {
          const cachedPath = cache.get(originalUrl);
          if (cachedPath) {
            localPaths.push(cachedPath);
          }
          processedImages += 1;
          if (process.stdout.isTTY) {
            updateTerminalProgress(
              '图片',
              `说说 ${postIndex + 1}/${posts.length}，图片 ${processedImages}/${totalImages}，已下载 ${totalDownloaded} 张`
            );
          }
          continue;
        }

        let relativePath = '';
        try {
          const response = await apiContext.get(originalUrl, {
            timeout: 30000,
            failOnStatusCode: false,
          });

          if (!response.ok()) {
            throw new Error(`HTTP ${response.status()}`);
          }

          const contentType = response.headers()['content-type'] || '';
          const extension = inferImageExtension(originalUrl, contentType);
          const postKey = sanitizeFileName(
            post.tid || post.created_time || `post_${String(postIndex + 1).padStart(4, '0')}`
          );
          const fileName = `${String(postIndex + 1).padStart(5, '0')}_${postKey}_${String(
            imageIndex + 1
          ).padStart(2, '0')}${extension}`;
          const filePath = path.join(imageDir, fileName);
          fs.writeFileSync(filePath, await response.body());
          relativePath = path.join(imageDirName, 'images', fileName).replace(/\\/g, '/');
          cache.set(originalUrl, relativePath);
          localPaths.push(relativePath);
          totalDownloaded += 1;
        } catch (requestError) {
          try {
            const browserResult = await downloadImageViaBrowserPage(page, originalUrl);
            if (!browserResult || !browserResult.buffer) {
              throw new Error('browser fallback returned no data');
            }
            const extension = inferImageExtension(originalUrl, browserResult.contentType);
            const postKey = sanitizeFileName(
              post.tid || post.created_time || `post_${String(postIndex + 1).padStart(4, '0')}`
            );
            const fileName = `${String(postIndex + 1).padStart(5, '0')}_${postKey}_${String(
              imageIndex + 1
            ).padStart(2, '0')}${extension}`;
            const filePath = path.join(imageDir, fileName);
            fs.writeFileSync(filePath, browserResult.buffer);
            relativePath = path.join(imageDirName, 'images', fileName).replace(/\\/g, '/');
            cache.set(originalUrl, relativePath);
            localPaths.push(relativePath);
            totalDownloaded += 1;
          } catch (browserError) {
            try {
              const navigationResult = await downloadImageViaBrowserNavigation(navigationPage, originalUrl);
              if (!navigationResult || !navigationResult.buffer) {
                throw new Error('browser navigation fallback returned no data');
              }
              const extension = inferImageExtension(originalUrl, navigationResult.contentType);
              const postKey = sanitizeFileName(
                post.tid || post.created_time || `post_${String(postIndex + 1).padStart(4, '0')}`
              );
              const fileName = `${String(postIndex + 1).padStart(5, '0')}_${postKey}_${String(
                imageIndex + 1
              ).padStart(2, '0')}${extension}`;
              const filePath = path.join(imageDir, fileName);
              fs.writeFileSync(filePath, navigationResult.buffer);
              relativePath = path.join(imageDirName, 'images', fileName).replace(/\\/g, '/');
              cache.set(originalUrl, relativePath);
              localPaths.push(relativePath);
              totalDownloaded += 1;
            } catch (navigationError) {
              cache.set(originalUrl, '');
              downloadErrors.push(
                `${originalUrl} :: request=${String(requestError)} :: browser=${String(browserError)} :: navigation=${String(navigationError)}`
              );
            }
          }
        }
        processedImages += 1;
        if (process.stdout.isTTY) {
          updateTerminalProgress(
            '图片',
            `说说 ${postIndex + 1}/${posts.length}，图片 ${processedImages}/${totalImages}，已下载 ${totalDownloaded} 张`
          );
        }
      }

      post.downloaded_image_count = localPaths.length;
      post.downloaded_image_paths = localPaths.join('\n');
      post.image_urls = urls.join('\n');
      post.download_errors = downloadErrors.join('\n');
    }
  } finally {
    finishTerminalProgress();
    if (navigationPage) {
      await navigationPage.close().catch(() => {});
    }
    await apiContext.dispose();
  }

  return {
    imageDir,
    imageDirName,
    totalDownloaded,
  };
}

function writeViewerHtml(posts, outputPath, targetQq) {
  const viewerPosts = enrichPostsForViewer(posts);
  const cards = viewerPosts
    .map((post, index) => {
      const imagePaths = String(post.downloaded_image_paths || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      const remoteUrls = collectPostImageUrls(post);
      const imageMarkup = imagePaths.length
        ? imagePaths
            .map(
              (item) =>
                `<a class="image-link" href="${escapeHtml(item)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${escapeHtml(
                  item
                )}" alt="post image"></a>`
            )
            .join('')
        : remoteUrls
            .map(
              (item) =>
                `<a class="image-link" href="${escapeHtml(item)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${escapeHtml(
                  item
                )}" alt="post image"></a>`
            )
            .join('');

      return `
        <article class="card" data-created-at="${post._created_at_ms || ''}" data-updated-at="${
        post._updated_at_ms || ''
      }" data-viewer-index="${post._viewer_index}">
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
          ${
            imageMarkup
              ? `<div class="image-grid">${imageMarkup}</div>`
              : '<div class="no-image">无图片</div>'
          }
          <div class="card-foot">
            <span>评论 ${escapeHtml(post.comment_count)}</span>
            <span>点赞 ${escapeHtml(post.like_count)}</span>
            <span>图片 ${escapeHtml(post.image_count)}</span>
            ${
              post.post_url
                ? `<a href="${escapeHtml(
                    post.post_url
                  )}" target="_blank" rel="noopener noreferrer">打开原说说</a>`
                : ''
            }
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
    :root {
      --bg: #f4efe7;
      --card: rgba(255,255,255,0.9);
      --line: rgba(47, 43, 38, 0.12);
      --text: #2f2b26;
      --muted: #72695d;
      --accent: #c85c3c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(200,92,60,0.18), transparent 26%),
        linear-gradient(180deg, #f8f3eb 0%, var(--bg) 100%);
    }
    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 20px 56px;
    }
    .hero {
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(12px);
      background: rgba(244,239,231,0.82);
      border-bottom: 1px solid var(--line);
      padding: 16px 0 14px;
      margin-bottom: 20px;
    }
    .hero h1 {
      margin: 0 0 6px;
      font-size: 28px;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin: 16px 0 18px;
    }
    .toolbar label {
      color: var(--muted);
      font-size: 14px;
    }
    .toolbar select {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.92);
      border-radius: 10px;
      padding: 8px 12px;
      color: var(--text);
    }
    .grid {
      display: grid;
      gap: 18px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 18px 40px rgba(90, 74, 54, 0.08);
    }
    .card-head, .card-foot {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .card-head h2 {
      margin: 2px 0 0;
      font-size: 18px;
    }
    .meta-index, .meta-right, .card-foot, .no-image {
      color: var(--muted);
      font-size: 13px;
    }
    .meta-right, .card-foot {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .content {
      margin: 14px 0 16px;
      line-height: 1.75;
      font-size: 15px;
      white-space: normal;
      word-break: break-word;
    }
    .image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 10px;
    }
    .image-link {
      display: block;
      border-radius: 14px;
      overflow: hidden;
      background: #efe4d5;
      border: 1px solid rgba(47, 43, 38, 0.08);
      min-height: 120px;
    }
    .image-link img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (max-width: 720px) {
      .wrap { padding: 18px 14px 40px; }
      .hero h1 { font-size: 22px; }
      .image-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>QQ空间说说浏览</h1>
      <p>QQ号 ${escapeHtml(targetQq)}，共 ${posts.length} 条说说。默认按最新在前显示；图片优先读取已下载到本地的文件。</p>
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
      const grid = document.querySelector('.grid');
      const select = document.querySelector('#sortSelect');
      if (!grid || !select) return;
      const cards = Array.from(grid.querySelectorAll('.card'));
      const getNumber = (node, key) => {
        const raw = node.getAttribute(key);
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
      };
      const fallbackIndex = (node) => Number(node.getAttribute('data-viewer-index') || 0);
      const sortCards = (mode) => {
        const sorted = cards.slice().sort((a, b) => {
          const aCreated = getNumber(a, 'data-created-at');
          const bCreated = getNumber(b, 'data-created-at');
          const aUpdated = getNumber(a, 'data-updated-at');
          const bUpdated = getNumber(b, 'data-updated-at');
          if (mode === 'created_asc') {
            if (aCreated != null && bCreated != null && aCreated !== bCreated) return aCreated - bCreated;
            return fallbackIndex(a) - fallbackIndex(b);
          }
          if (mode === 'updated_desc') {
            const left = aUpdated != null ? aUpdated : aCreated;
            const right = bUpdated != null ? bUpdated : bCreated;
            if (left != null && right != null && left !== right) return right - left;
            return fallbackIndex(a) - fallbackIndex(b);
          }
          if (mode === 'updated_asc') {
            const left = aUpdated != null ? aUpdated : aCreated;
            const right = bUpdated != null ? bUpdated : bCreated;
            if (left != null && right != null && left !== right) return left - right;
            return fallbackIndex(a) - fallbackIndex(b);
          }
          if (aCreated != null && bCreated != null && aCreated !== bCreated) return bCreated - aCreated;
          return fallbackIndex(a) - fallbackIndex(b);
        });
        for (const card of sorted) grid.appendChild(card);
      };
      select.addEventListener('change', () => sortCards(select.value));
      select.value = 'created_desc';
      sortCards('created_desc');
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const config = resolveConfig(cliArgs);

  ensureDir(config.tempDir);
  ensureDir(config.resultDir);

  let browser = null;
  let context = null;
  if (!config.checkpoint) {
    if (config.connectCdp) {
      browser = await chromium.connectOverCDP(config.connectCdp);
      context = browser.contexts()[0];
      if (!context) {
        throw new Error(`No browser context found via CDP: ${config.connectCdp}`);
      }
    } else {
      if (!fs.existsSync(config.browserPath)) {
        throw new Error(`Browser executable was not found: ${config.browserPath}`);
      }

      const profileDir = path.join(
        config.tempDir,
        config.mobile ? 'chrome-profile-mobile' : 'chrome-profile'
      );
      ensureDir(profileDir);

      const launchOptions = config.mobile
        ? {
            executablePath: config.browserPath,
            headless: config.headless,
            viewport: { width: 390, height: 844 },
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
              '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          }
        : {
            executablePath: config.browserPath,
            headless: config.headless,
            viewport: { width: 1400, height: 900 },
            userAgent: USER_AGENT,
          };

      context = await chromium.launchPersistentContext(profileDir, launchOptions);
    }
  }

  try {
    if (config.checkpoint) {
      const { payload, posts, qq, baseName } = loadCheckpoint(config.checkpoint);
      const targetQq = config.targetQq || qq || 'unknown';
      const jsonPath = path.join(config.resultDir, `${baseName}.json`);
      const excelPath = path.join(config.resultDir, `${baseName}.xlsx`);
      const htmlPath = path.join(config.resultDir, `${baseName}.html`);

      writeJson(posts, jsonPath);
      writeExcel(posts, excelPath);
      writeViewerHtml(posts, htmlPath, targetQq);
      console.log('Base export written. Starting image download phase...');
      const downloadSummary = await downloadImagesForPosts(
        posts,
        config.resultDir,
        baseName,
        context,
        null
      );
      writeJson(posts, jsonPath);
      writeExcel(posts, excelPath);
      writeViewerHtml(posts, htmlPath, targetQq);

      console.log(
        `Checkpoint export done. Pages ${payload.start_page || '?'}-${payload.last_completed_page || '?'}, posts: ${posts.length}`
      );
      console.log(`Images: ${downloadSummary.totalDownloaded} downloaded to ${downloadSummary.imageDir}`);
      console.log(`JSON : ${jsonPath}`);
      console.log(`Excel: ${excelPath}`);
      console.log(`HTML : ${htmlPath}`);
      return;
    }

    let resumeState = null;
    if (config.resumeCheckpoint) {
      resumeState = loadCheckpoint(config.resumeCheckpoint);
    }

    const page = config.connectCdp
      ? await prepareConnectedPage(context, config.mobile)
      : context.pages()[0] || (await context.newPage());
    const entryUrl = config.mobile ? 'https://mobile.qzone.qq.com/' : 'https://qzone.qq.com/';
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
    console.log(
      config.mobile
        ? 'Mobile-mode browser opened. Complete the QQ login in the browser if prompted.'
        : 'Browser opened. Scan the QR code and confirm login in mobile QQ.'
    );

    const loginState = config.mobile
      ? await waitForMobileLogin(context, page, config.loginTimeoutSeconds)
      : await waitForLogin(context, page, config.loginTimeoutSeconds);
    const targetQq = config.targetQq || (resumeState ? resumeState.qq : '') || loginState.qq;
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '_');
    const baseName = resumeState ? resumeState.baseName : `${targetQq}_${timestamp}`;
    const jsonPath = path.join(config.resultDir, `${baseName}.json`);
    const excelPath = path.join(config.resultDir, `${baseName}.xlsx`);
    const htmlPath = path.join(config.resultDir, `${baseName}.html`);
    const checkpointPath = resumeState
      ? config.resumeCheckpoint
      : path.join(config.resultDir, `${baseName}.checkpoint.json`);
    const effectiveStartPage = resumeState
      ? Math.max(Number(resumeState.payload.last_completed_page || 0) + 1, config.startPage)
      : config.startPage;

    console.log(`Login succeeded. Current QQ: ${loginState.qq}`);
    console.log(`Fetching posts for target QQ: ${targetQq}`);
    console.log(
      `Desktop pacing: start=${effectiveStartPage}, end=${config.endPage || 'auto'}, wait=${config.pageWaitMs}ms, segment=${config.segmentPages} pages, pause=${config.segmentPauseMs}ms`
    );
    if (resumeState) {
      console.log(
        `Resuming from checkpoint ${checkpointPath}. Existing posts: ${resumeState.posts.length}, last completed page: ${resumeState.payload.last_completed_page}`
      );
    }
    let posts;
      if (config.mobile) {
        await ensureMobileAuthenticated(page, targetQq, config.loginTimeoutSeconds);
        try {
          posts = await fetchPostsViaMobileApiPagination(page, targetQq);
        if (!posts.length) {
          posts = await fetchPostsFromMobileDom(page, targetQq, config.loginTimeoutSeconds);
        }
        } catch (error) {
          console.log(`Mobile API capture did not succeed: ${String(error)}`);
          posts = await fetchPostsFromMobileDom(page, targetQq, config.loginTimeoutSeconds);
        }
      } else {
        posts = await fetchPostsViaDesktopDom(
          page,
          targetQq,
          {
            maxPages: config.maxPages,
            startPage: effectiveStartPage,
            pageWaitMs: config.pageWaitMs,
            endPage: config.endPage,
            segmentPages: config.segmentPages,
            segmentPauseMs: config.segmentPauseMs,
            stagnantPageLimit: config.stagnantPageLimit,
            seedPosts: resumeState ? resumeState.posts : [],
            onCheckpoint: async ({ posts: partialPosts, lastPage, isFinal }) => {
              writeCheckpoint(partialPosts, checkpointPath, {
                qq: targetQq,
                last_completed_page: lastPage,
                start_page: resumeState
                  ? Number(resumeState.payload.start_page || effectiveStartPage)
                  : effectiveStartPage,
                end_page: config.endPage || null,
                is_final: isFinal,
              });
            },
          }
        );
      }

    writeJson(posts, jsonPath);
    writeExcel(posts, excelPath);
    writeViewerHtml(posts, htmlPath, targetQq);
    console.log('Base export written. Starting image download phase...');
    const downloadSummary = await downloadImagesForPosts(
      posts,
      config.resultDir,
      baseName,
      context,
      page
    );
    writeJson(posts, jsonPath);
    writeExcel(posts, excelPath);
    writeViewerHtml(posts, htmlPath, targetQq);

    console.log(`Done. Exported ${posts.length} posts.`);
    console.log(`Images: ${downloadSummary.totalDownloaded} downloaded to ${downloadSummary.imageDir}`);
    console.log(`Checkpoint: ${checkpointPath}`);
    console.log(`JSON : ${jsonPath}`);
    console.log(`Excel: ${excelPath}`);
    console.log(`HTML : ${htmlPath}`);
  } finally {
    if (browser) {
      await browser.close();
    } else if (context) {
      await context.close();
    }
  }
}

main().catch((error) => {
  if (isBrowserClosedError(error)) {
    const cliArgs = parseArgs(process.argv.slice(2));
    const config = resolveConfig(cliArgs);
    const resumeCheckpoint = config.resumeCheckpoint || config.checkpoint || '';
    console.error('浏览器或页面已被关闭，当前任务已中断。');
    if (resumeCheckpoint) {
      console.error(`请使用这个 checkpoint 继续：${resumeCheckpoint}`);
      console.error(`续跑命令：node get_qzone_history_browser.js --resume-checkpoint "${resumeCheckpoint}"`);
    } else {
      console.error(`请到 ${config.resultDir} 中找到最新的 .checkpoint.json 文件，再用 --resume-checkpoint 继续。`);
    }
  } else {
    console.error(error.stack || String(error));
  }
  process.exitCode = 1;
});
