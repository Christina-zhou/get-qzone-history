# GetQzoneHistory

![GetQzoneHistory Banner](assets/get-qzone-history-banner.svg)

一个用于导出 QQ 空间历史说说的小工具。它通过真实浏览器登录 QQ 空间，抓取可访问的历史说说，并生成适合长期保存和本地浏览的 `HTML`、`JSON`、`Excel` 文件。

演示预览：  
https://htmlpreview.github.io/?https://raw.githubusercontent.com/Christina-zhou/get-qzone-history/main/resource/publish-demo/demo-viewer.html

## 本次版本更新

- 解决图片无法稳定下载到本地的问题，导出结果可直接关联本地图片文件
- 解决长文说说在抓取时被截断的问题，改为在列表页展开后再提取正文
- 新增两份说明文档：
  - `零基础用户操作手册.md`
  - `AI项目说明手册.md`

## 功能特点

- 扫码登录：使用 Playwright 驱动真实浏览器登录 QQ 空间
- 列表页抓取：在桌面版说说列表页展开正文后抓取内容
- 自动翻页：通过“下一页”逐页抓取历史说说
- 图片下载：自动下载正文图片区图片到本地目录
- 多格式导出：同时生成 `HTML`、`JSON`、`XLSX`
- 断点续跑：支持 `checkpoint` 续跑长任务
- 本地浏览：生成离线 HTML 浏览页，便于按时间查看内容和图片

## 适用场景

- 备份自己的 QQ 空间历史说说
- 导出结构化数据用于检索、整理或交给 AI 处理
- 生成不依赖 QQ 空间在线服务的本地浏览结果

## 环境要求

- Node.js 18+
- Google Chrome
- Windows 优先，其他桌面系统理论可用

## 安装

```bash
git clone https://github.com/Christina-zhou/get-qzone-history.git
cd get-qzone-history
npm install
```

如需使用 Python 入口：

```bash
pip install -r requirements.txt
```

## 快速开始

最常用方式：

```bash
node get_qzone_history_browser.js
```

指定目标 QQ：

```bash
node get_qzone_history_browser.js --target-qq 123456789
```

指定页码范围：

```bash
node get_qzone_history_browser.js --start-page 1 --end-page 50
```

慢速抓取，降低风控概率：

```bash
node get_qzone_history_browser.js --page-wait-ms 20000 --segment-pages 10 --segment-pause-ms 180000
```

从 checkpoint 继续：

```bash
node get_qzone_history_browser.js --resume-checkpoint "resource/result/你的checkpoint文件名.checkpoint.json"
```

Python 包装入口：

```bash
python get_qzone_history.py
```

## 运行流程

1. 脚本打开 Chrome 并进入 QQ 空间
2. 用户手动扫码登录
3. 登录成功后开始抓取当前页
4. 每页等待内容和图片加载完成
5. 点击“下一页”继续抓取
6. 最终输出到 `resource/result/`

## 输出文件

抓取完成后会生成：

```text
resource/result/
├── <QQ号>_<时间戳>.json
├── <QQ号>_<时间戳>.xlsx
├── <QQ号>_<时间戳>.html
├── <QQ号>_<时间戳>.checkpoint.json
└── <QQ号>_<时间戳>_assets/
    └── images/
```

说明：

- `html`：离线浏览页
- `json`：结构化结果
- `xlsx`：Excel 查看
- `checkpoint.json`：中断续跑
- `images/`：下载到本地的正文图片

仓库内额外保留匿名演示样本：

```text
resource/publish-demo/
├── demo-posts.json
└── demo-viewer.html
```

真实抓取结果、缓存和日志不会提交到 GitHub。

## 重要文档

- `零基础用户操作手册.md`：面向 0 代码基础用户
- `AI项目说明手册.md`：面向 AI 助手和后续维护者

## 项目结构

```text
get-qzone-history/
├── get_qzone_history_browser.js
├── get_qzone_history.py
├── repair_export_counts.js
├── qzone_history.ini
├── package.json
├── requirements.txt
├── 零基础用户操作手册.md
├── AI项目说明手册.md
├── assets/
└── resource/
    └── publish-demo/
```

## 常见问题

**Q: 为什么要使用真实浏览器而不是纯接口抓取？**  
A: QQ 空间存在登录态、风控和动态加载问题。真实浏览器方案更接近人工操作，稳定性更高。

**Q: 为什么有时会提示“使用人数过多”或被 WAF 拦截？**  
A: 这是 QQ 空间侧的限流或风控。建议增大 `--page-wait-ms` 和 `--segment-pause-ms`，并通过 checkpoint 分段运行。

**Q: 浏览器被我手动关掉了怎么办？**  
A: 使用最新的 `checkpoint.json` 配合 `--resume-checkpoint` 继续，不必从头重跑。

**Q: 仓库里为什么没有真实导出结果？**  
A: 开源仓库默认不应包含个人历史内容和图片，因此仓库只保留匿名演示文件。

## 致谢

- 原始灵感参考 [LibraHp/GetQzonehistory](https://github.com/LibraHp/GetQzonehistory)

## License

[MIT](LICENSE)

## English Summary

A browser-based tool for exporting QQ Zone post history into offline-viewable HTML pages, JSON files, and Excel spreadsheets. It supports QR login, desktop DOM pagination, local image download, checkpoint resume, and documentation for both end users and AI agents.
