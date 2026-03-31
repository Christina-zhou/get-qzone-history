# GetQzoneHistory

一个用于导出 QQ 空间历史说说的小工具。它会通过真实浏览器登录 QQ 空间，抓取可访问的历史说说，并生成适合长期保存和本地浏览的 HTML、JSON、Excel 文件。

## 功能特点

- 扫码登录：使用 Playwright 驱动真实浏览器登录 QQ 空间，无需手动抓包
- 自动翻页：支持桌面版和移动版两种抓取路径，自动翻页直到没有新增内容
- 图片下载：自动下载说说中的配图，便于离线备份
- 多格式导出：同时生成 Excel、JSON、HTML 三种结果文件
- 离线浏览：生成适合本地查看的单文件 HTML 页面，支持排序和图片浏览
- 断点续传：支持 checkpoint 机制，长时间抓取中断后可以继续
- 灵活配置：支持指定页码范围、分段暂停、连接已有浏览器等高级参数

## 适用场景

- 想把自己历年的 QQ 空间说说做一份本地备份
- 想把零散内容导出成结构化数据，便于后续检索或分析
- 想生成一个不依赖 QQ 空间在线服务的离线浏览页面

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Google Chrome](https://www.google.com/chrome/) 浏览器
- Windows / macOS / Linux

### 安装

```bash
# 克隆仓库
git clone https://github.com/Christina-zhou/get-qzone-history.git
cd get-qzone-history

# 安装依赖
npm install
```

> 注意：首次运行 `npm install` 时，Playwright 可能会下载浏览器运行依赖，耗时会稍长一些。如果本机已经安装 Chrome，可以用 `--browser-path` 指向现有浏览器。

### 使用

```bash
# 基本用法：获取自己的说说
node get_qzone_history_browser.js

# 指定浏览器路径
node get_qzone_history_browser.js --browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"

# 抓取指定 QQ 号的说说（需要有访问权限）
node get_qzone_history_browser.js --target-qq 123456789

# 使用移动版模式（某些情况下能获取更多历史说说）
node get_qzone_history_browser.js --mobile

# 指定页码范围
node get_qzone_history_browser.js --start-page 1 --end-page 50
```

运行流程：
1. 浏览器会自动打开 QQ 空间登录页面
2. 用手机 QQ 扫码登录
3. 登录成功后自动开始抓取
4. 抓取完成后结果保存在 `resource/result/` 目录下

### Python 入口（可选）

如果你更习惯 Python：

```bash
pip install -r requirements.txt
python get_qzone_history.py
```

这个入口实际上调用的是同一个 Node.js 脚本。

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--config` | 配置文件路径 | `qzone_history.ini` |
| `--target-qq` | 目标 QQ 号 | 登录账号本人 |
| `--browser-path` | Chrome 浏览器路径 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `--headless` | 无头模式运行 | 关闭 |
| `--mobile` | 使用移动版模式抓取 | 关闭 |
| `--connect-cdp` | 连接已有浏览器的 CDP 地址 | - |
| `--start-page` | 起始页码 | 1 |
| `--end-page` | 结束页码 | 不限 |
| `--page-wait-ms` | 每页等待时间（毫秒） | 20000 |
| `--segment-pages` | 每多少页暂停一次 | 30 |
| `--segment-pause-ms` | 暂停时长（毫秒） | 180000 |
| `--checkpoint` | 从 checkpoint 文件恢复 | - |
| `--resume-checkpoint` | 指定续传的 checkpoint | - |
| `--stagnant-page-limit` | 连续无新内容页数阈值 | 8 |

## 配置文件

`qzone_history.ini` 示例：

```ini
[paths]
temp_dir = resource/temp
result_dir = resource/result

[login]
poll_interval_seconds = 2
login_timeout_seconds = 180

[fetch]
page_size = 20
max_pages = 0
```

## 输出文件

抓取完成后，在 `resource/result/` 目录下生成：

```
resource/result/
├── <QQ号>_<时间戳>.xlsx          # Excel 格式
├── <QQ号>_<时间戳>.json          # JSON 格式
├── <QQ号>_<时间戳>.html          # 可离线浏览的网页
├── <QQ号>_<时间戳>.checkpoint.json  # 断点续传文件
└── <QQ号>_<时间戳>_assets/       # 下载的图片
    └── images/
```

为了方便在 GitHub 仓库中展示项目效果，仓库内额外提供一组匿名示例文件：

```
resource/publish-demo/
├── demo-posts.json   # 匿名示例数据，对应结构化导出结果
└── demo-viewer.html  # 匿名示例页面，对应最终离线浏览页面
```

这个目录只用于开源展示，不包含真实账号的运行结果、缓存文件或登录信息。

## 项目结构

```
get-qzone-history/
├── get_qzone_history_browser.js  # 核心脚本（Playwright + Node.js）
├── get_qzone_history.py          # Python 入口（调用 Node.js 脚本）
├── qzone_history.ini             # 配置文件
├── requirements.txt              # Python 依赖
├── package.json                  # Node.js 依赖
├── resource/                     # 运行时资源目录
│   ├── result/                   # 导出结果（git 忽略）
│   ├── temp/                     # 临时文件（git 忽略）
│   └── publish-demo/             # 发布展示用的匿名示例文件
├── LICENSE
└── README.md
```

## 常见问题

**Q: 提示 Tencent WAF 拦截怎么办？**
A: 腾讯可能对频繁访问进行风控。可以尝试：增大 `--page-wait-ms` 和 `--segment-pause-ms`；使用 `--mobile` 模式；过一段时间再试。

**Q: 如何获取更多历史说说？**
A: QQ 空间接口本身有限制。可以先用桌面模式抓取，再用 `--mobile` 模式补充。两次结果会自动去重。

**Q: 图片下载失败怎么办？**
A: 部分历史图片可能已被 QQ 服务器清理。脚本会自动跳过下载失败的图片并记录错误。

**Q: 仓库里的示例文件为什么不是我的真实说说？**
A: 开源仓库默认不应包含个人隐私数据，因此仓库只保留匿名示例文件来展示导出效果。你本地运行后生成的真实结果仍会保存在 `resource/result/` 中，但默认不会提交到 Git。

## 致谢

- 登录方法参考自 [python-QQ空间扫码登录](https://blog.csdn.net/m0_50153253/article/details/113780595)
- 原始项目灵感来自 [LibraHp/GetQzonehistory](https://github.com/LibraHp/GetQzonehistory)

## License

[MIT](LICENSE)

---

## English Summary

A tool for exporting QQ Zone post history into offline-viewable HTML pages, JSON files, and Excel spreadsheets.

**Features**: browser-based QR login via Playwright, automatic pagination, image downloading, checkpoint resume, and clean offline export formats.

**Quick start**: `git clone`, `npm install`, `node get_qzone_history_browser.js`, scan the QR code with mobile QQ, then wait for the export to finish.
