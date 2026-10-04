# bili-music-player 交接文档

> **状态快照：2026-10-03 · 主线版本 `v1.0.0`**
> 本文记录当前公开代码的架构、验证基线与已知限制；具体功能进度以 `ROADMAP.md` 与近期提交为准。
> **P0–P8 全部完成；P5（评论与社交）与 P9（听歌识曲）按约定不做**（P9 有完整 spike 结论）。
> `ROADMAP.md` 是**唯一进度事实来源**：功能清单、接口验证记录、变更记录、设备记录、测试基线都在里面。
> 本机环境（JDK / adb / 代理 / 设备小抄）见 `HANDOVER-LOCAL.md`（**不入仓库**，若接手者用别的机器可忽略）。

---

## 1. 项目是什么

非官方本地音乐播放器：**导入 QQ 音乐歌单 → 自动匹配 B 站视频 → 播放 B 站音频**（默认音源），
也可切到 QQ 音乐直链。**不绕过任何付费 / 版权限制**（VIP/无版权歌曲只做提示 + 自动回退），使用时请遵守相关平台规则与适用法律。

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/mingyi502/bili-music-player |
| 许可 / 作者 | MIT / mingyi502 |
| 技术栈 | Vue 3.4 + Vite 7.3 + blueimp-md5；Android 用 Capacitor 8 |
| Capacitor 依赖 | core/android 8.5.2、filesystem 8.1.3、file-transfer 2.0.5、clipboard 8.0.1 |
| Node | `engines: >=20`（实测 v24.14.1） |
| 版本号 | **1.0.0（已统一）**：`package.json` 为单一来源，Android `versionName` 由 Gradle 读取（APK 命名 `v1.0.0`） |
| 应用包名 | `com.bilimusic.player`（2026-09-26 中性化；旧 `com.mingyi502.bilimusicplayer` 不再发布） |

### 当前能力总览（P0–P8）

- **曲库浏览**：歌单导入（链接/ID）、我喜欢的音乐、综合搜索（单曲/专辑/歌单/歌手 4 Tab + 分页 + 历史）、
  热搜榜 + 输入联想、排行榜（4 分组 / 30 榜）、歌单广场（分类 + 排序 + 卡片墙）、每日推荐（雷达凑 30 首）、
  私人 FM（雷达 + 自动补货 + 不喜欢）、歌手页（详情/热门/单曲/专辑/相似）、专辑页、歌曲详情（相似 + 评论）
- **播放**：B 站音源（默认，自动匹配）/ QQ 直链（单曲可选）、队列（拖动排序/持久化）、最近播放、
  睡眠定时、媒体控制（Web MediaSession；App 通知栏/锁屏/蓝牙按键）、桌面歌词悬浮窗（App）、
  播放页（歌词/封面切换、逐行校准、**逐字（QRC）+ 罗马音**）
- **写操作**（需 `qm_keyst` 票据，走签名网关）：红心、收藏/取消收藏专辑、收藏/取消收藏歌单、
  创建歌单、删除歌单、批量加歌/删歌
- **离线**：单曲下载（持久目录）、歌单批量下载（并发 2 + 失败重跑）、离线优先播放、
  本地音乐导入、`/storage` 存储管理（占用统计 + 分类清理）
- **数据**：听歌报告 `/report`（次数/时长/Top 歌曲与歌手/时段/每日）、歌单导出 JSON/m3u + 导入、
  多账号切换（`bmp:accounts`）
- **外观与平台**：亮/暗/跟随系统主题、迷你播放器悬浮窗（App）、桌面小组件（App，4x1）
- **不做**：P9 听歌识曲（spike 结论：QQ 识曲为 ACRCloud 商业授权、Shazam 非官方端点不可用，
  详见 `ROADMAP.md` 第 5 节）；P5 中仅 E4 一起听收口不做（候选模块均 500003，私有实时协议），
  E2 评论写（发/回复/删除，点赞未实现）、E3 分享、E5 关注歌手只读均已落地

---

## 2. 当前状态一览

| 阶段 | 状态 | 内容 |
|---|---|---|
| P0 | ✅ | 状态层/接口层按域拆分 + 守卫测试 |
| P1 | ✅ | 队列 / 最近播放 / 睡眠定时 / 媒体控制（Web + App 原生） |
| P2 | ✅ | 歌词（LRC + 翻译 + 缓存 + 校准 + 默认歌词视图）/ 桌面歌词悬浮窗 |
| P3 | ✅ | 搜索 / 热搜联想 / 排行榜 / 歌单广场 / 每日推荐 / 私人 FM / 歌手 / 专辑 / 歌曲详情 |
| P4 | ✅ | 写操作基础设施（签名网关）+ 红心 + 收藏专辑/歌单 + 创建/删除歌单 + 加歌/删歌（D5/D8/D9 ⏸） |
| P5 | ✅（E4 ⛔） | 评论写（发/回复/删除，签名网关）+ 分享（链接/二维码/系统分享）+ 关注歌手只读；一起听收口不做（E5 好友动态不可用） |
| P6 | ✅ | 下载与离线（单曲/批量/离线优先/本地导入/存储管理） |
| P7 | ✅ | 付费受限识别 / 多账号 / 听歌报告 / 导入导出 |
| P8 | ✅ | 主题 / 迷你播放器 / 桌面小组件 / 逐字歌词与罗马音（P8.4，追加） |
| P9 | ⛔ | 听歌识曲（仅 spike，结论不做） |
| UI 优化 | ✅ | 移动端歌曲行瘦身 + 播放页压缩 + 顶栏语境化 + 歌单头部收敛（2026-09-25，两批提交） |
| 登录健壮性 | ✅ | F1–F3：轮询/生成失败自动重试 + 英文报错中文化 + 回前台补轮询（2026-09-26，含真机断网复验） |
| 开源清理 | ✅ | 隐私清理（QQ 号/账号派生数据/截图）+ 包名中性化 `com.bilimusic.player` + 版本统一 1.0.0（2026-09-26，真机装新包 sanity 通过） |
| UI 收尾 | ✅ | `.rk-row` 行内操作（TrackActions）+ 桌面歌词逐字/罗马音 + 网页登录默认二维码（2026-09-26，含真机复验与导入/P4 回归） |
| 体验收尾 | ✅ | ① 通知栏/迷你卡歌词行；② 歌单批量选择；④ 搜索小增强（2026-09-27，真机复验：通知栏歌词跨行更新、迷你卡三行、选择模式入口/全选/退出） |
| 红心显示修复 | ✅ | 触屏点按后 WebView 粘住 `:hover` 致未喜欢也显示玫瑰红（2026-09-27 真机 CDP 定位；hover 效果限定 `(hover: hover)`；附 2001 错误码中文化） |
| 滑动手势 | ✅ | 主界面右滑开侧栏、左滑开播放队列；抽屉左滑收、队列右滑收（2026-09-27，真机 `input swipe` 复验） |
| 队列侧栏化 | ✅ | 播放队列改右侧边栏（满高/贴右/与左抽屉对称）+ 窄屏冷启动默认展开左侧栏（2026-09-27，真机复验） |

### 测试基线（必须保持全绿）

| 套件 | 命令 | 基线 |
|---|---|---|
| 平台层 | `npm run test:platform` | **329 / 0 FAIL** |
| 安全回归 | `npm run test:security` | 代理重定向与登录跳转白名单 |
| e2e | `npm run test:e2e` | **369 / 0 FAIL** |
| UI 桌面 | `npm run test:ui` | **15 / 0 FAIL** |
| UI 桌面+演示 | `npm run test:ui:demo` | **152 / 0 FAIL**（可跳过用例较多，实测 148–152） |
| UI 移动 | `npm run test:ui:mobile` | **26 / 0 FAIL** |
| UI 移动+演示 | `npm run test:ui:mobile:demo` | **170 / 0 FAIL**（同上，实测 166–170） |

> e2e 的 `media-api 代理音频流` / `支持 Range` 两条依赖 B 站上游，**限流时会间歇 502 FAIL，重跑即恢复**（已知 flaky）。

---

## 3. 快速开始

```bash
npm install
npm start            # vite --open，默认 http://localhost:5173
npm run dev          # 不自动开浏览器
npm run build        # 产出 dist/
npm run preview      # 预览构建产物（同样注册中间件）
```

Windows 一键脚本（**GBK 编码**，`.gitattributes` 里 `*.bat -text` 保护，**勿用编辑器转码**）：

| 脚本 | 场景 |
|---|---|
| `start.bat` | 本机（只绑 127.0.0.1） |
| `start-lan.bat` | 局域网（绑 0.0.0.0 + 强制口令，手机同 Wi-Fi 访问） |
| `start-usb.bat` | USB 方式（localhost + `adb reverse`） |

环境变量：

| 变量 | 作用 |
|---|---|
| `BMP_LAN=1` | 绑定 0.0.0.0（默认只绑 127.0.0.1） |
| `BMP_ACCESS_CODE=xxxx` | 指定访问口令；不指定则启动时随机生成并打印 |
| `BMP_FORCE_TOKEN=1` | 本机也强制校验令牌（测试用） |
| `QQ_DEBUG=1` | 打印 QQ 登录流程调试日志 |
| `BMP_URL` / `BMP_COOKIE` | 仅测试用（见第 7 节） |

### 跑测试（重要约定）

```powershell
# 1) 起独立测试服务（5199），PID 写临时文件，绝不按端口杀进程
$p = Start-Process node -ArgumentList "node_modules/vite/bin/vite.js","--port","5199","--strictPort","--host","127.0.0.1" -PassThru -WindowStyle Hidden
$p.Id | Out-File "$env:TEMP\bmp-test-server.pid" -Encoding ascii

# 2) 全部套件（BMP_URL 指向 5199）
$env:BMP_URL='http://127.0.0.1:5199'
npm run test:platform
npm run test:e2e
npm run test:ui
npm run test:ui:demo
npm run test:ui:mobile
npm run test:ui:mobile:demo
```

> 长会话后 Vite 模块缓存会过期（报 `does not provide an export named ...`）→ **重启 5199 服务**再跑。
> 演示模式（`--demo`）完全不依赖外网；`--logged-in` 需要 `BMP_COOKIE` 或配合 `--demo` 注入合成数据。

---

## 4. 架构与目录

```
UI 组件 ──► src/store（唯一状态源）──► src/api（只描述"上游 + 路径"）
                                   ├► src/core（平台无关：路由表 / 请求 / 登录 / 剪贴板 / 能力桥）
                                   └► src/platform（web：相对路径 + 中间件 / native：Capacitor 直连）
Web：Vite 中间件把相对路径代理到上游，并补 Referer / Origin / Cookie
App：CapacitorHttp 直连上游，域名 / Referer 由 src/core/upstreams.js 提供
```

### 目录职责（P3–P8 后）

| 路径 | 职责 |
|---|---|
| `src/router/index.js` | vue-router 4（hash）；路由：`/`（歌单）、`/daily`、`/fm`、`/artist/:mid`、`/album/:mid`、`/song/:id`、`/search`、`/rank`、`/square`、`/history`、`/storage`、`/report` |
| `src/core/upstreams.js` | **唯一事实来源**：`UPSTREAMS`（`/qq-api`→c.y.qq.com、`/qqmu-api`→u.y.qq.com、`/bili-api`→api.bilibili.com）、图片/媒体白名单与 Referer、UA |
| `src/core/http.js` | `httpRequest` / `qs` / `setHttpInterceptor` / `setRequestTransport` / `setMediaResolvers` / `resolveImageUrl` / `resolveAudioUrl` |
| `src/core/qqLogin.js` | QQ 登录核心（常量、`hash33`/`getGtk`、扫码/网页登录、票据兑换、会话 TTL） |
| `src/core/zzcSign.js` | **写通道签名**（`zzcSign`：SHA1(请求体) → 索引抽取 + XOR 魔数 + base64 去 `[\\/+=]`，前缀 `zzc`） |
| `src/core/downloads.js` | 下载能力桥（原生注入；Web 未注入 → 隐藏下载入口） |
| `src/core/files.js` | 文本导出能力桥（App 写 `Directory.External/bmp-exports`；Web Blob 下载） |
| `src/core/mediaControl.js` | 媒体控制 / 悬浮窗 / 迷你播放器后端注入点（App 注入原生实现，Web 为空） |
| `src/core/clipboard.js` | 剪贴板接口（平台注入实现） |
| `src/api/qq/*` | QQ 接口（按域拆分）：`comm.js`（`buildComm`/`buildWriteComm`/`postMusicu`/`musicuCall`）、`util.js`、`user.js`、`song.js`（vkey 直链 + `parseSongUrlInfo` 受限识别 + `fetchTracksByMids`）、`playlist.js`、`album.js`、`artist.js`、`rank.js`、`square.js`、`daily.js`、`fm.js`、`songDetail.js`、`search.js`、`lyric.js`（QRC/明文歌词）、`fav.js`（红心 + 专辑/歌单收藏 + `PlaylistFavRead` 读取）、`write.js`（`writeCall` 签名网关 + 错误映射）、`playlistWrite.js`（创建/删除/批量加删歌）；`src/api/qq.js` 为兼容 barrel |
| `src/api/bilibili.js` | B 站搜索、视频信息、音频地址（`wbi.js` 负责 WBI 签名） |
| `src/api/auth.js` | 登录后端注入点、`pingServer` / `unlock` |
| `src/api/stats.js` | 听歌统计纯函数（`recordListen`/`addListenMs`/`statsSummary`/`formatListenDuration`，事件上限 5000） |
| `src/api/transfer.js` | 歌单导入导出纯函数（JSON `bmp-playlist` v1 / m3u / 解析 / 文件名安全化） |
| `src/platform/native/*` | `http`（CapacitorHttp + 路由改写 + base64）、`media`（图片/音频缓存、**下载/本地音乐/文本导出**、目录统计）、`auth`、`qqWebLogin`、`clipboard`、`base64`、`mediaControl`（通知栏/悬浮窗/迷你播放器） |
| `src/store/*` | 状态层：`state.js`（唯一状态源 + 持久化 + **`loadConfig()` 默认值合并**）、`player.js`（播放引擎/队列/匹配/音源策略/睡眠定时/**离线优先**）、`library.js`（歌单/我喜欢/专辑/**收藏歌单读路径**）、`user.js`、`lyric.js`（歌词缓存 v4 + 逐字/credit）、`desktopLyric.js`、`mediaSession.js`、`fav.js`/`favWrite.js`（红心/收藏）、`playlistWrite.js`、`write.js`（写守卫）、`downloads.js`（下载/导入/队列）、`stats.js`（收听事件）、`transfer.js`（导入导出）、`accounts.js`（多账号）、`theme.js`（主题）、`miniPlayer.js`、`diagnostics.js`、`errors.js`、`access.js`、`ui.js`（toast / confirm / prompt / **actionSheet**）；`src/store/index.js` 为聚合 barrel |
| `src/utils/` | `match.js`（匹配打分）、`lrc.js`（LRC 解析/翻译合并/校准换算）、`qrc.js`（**逐字解析/合并/词进度/credit 标记**）、`qqc3des.js`（**QRC 3DES 解密**）、`mediaCache.js`、`cookieImport.js`、`seek.js` |
| `src/components/` | `Sidebar`/`TopBar`/`PlayerBar`/`NowPlaying`/`QueuePanel`/`SongRow`/`AppImage`/`Icon`/`ConfirmDialog`（含 askPrompt）/`AddToPlaylistDialog`/**`ActionSheet`**/`SettingsDialog`/`LoginDialog`/`CandidateDialog`/`DiagnosticsDialog`/`SleepTimerButton`/`Toasts`/`UnlockGate` |
| `src/views/` | `PlaylistView`（歌单页 + 导出菜单 + 移动端「更多」）、`SearchView`、`RankView`、`SquareView`、`DailyView`、`FmView`、`ArtistView`、`AlbumView`、`SongDetailView`、`HistoryView`、**`StorageView`**、**`ReportView`** |
| `server/` | `access-guard.js`（口令守卫 + 限流 + `.bmp-sessions.json`）、`qq-login.js`（`/auth-api/*`）、`image-proxy.js`（`/img-api`、`/media-api`） |
| `vite.config.js` | guard → qqAuth → imageProxy → mediaProxy；`host` 条件绑定；`define` 注入版本号；capacitor 模式（`base:'./'`、不注册中间件） |
| `android/.../java/` | `MainActivity`、`QqLoginActivity`、`QqWebLoginPlugin`、`MediaControlPlugin`（update/setOverlay/updateLyric/**setMiniPlayer/updateMiniPlayer**/权限）、`MediaControlService`（MediaSession + 前台服务 + MediaStyle 通知 + 桌面歌词 + **迷你播放器卡**）、**`MiniWidgetProvider`**（4x1 小组件） |
| `scripts/` | 三套测试（`platform-test.mjs` / `e2e-test.mjs` / `browser-test.mjs`）+ `lib/mock-transport.mjs` + `fixtures/qq/*`（含 **`qrc-payload.json` 真实加密歌词样本**）+ **`android-cdp.mjs`**（真机 WebView 调试桥：list / eval / shot） |

---

## 5. 关键设计决策（含踩过的坑）

1. **平台无关三层**：`src/api` 只写"上游 + 路径"，域名 / Referer / Cookie 全由 `upstreams.js` 决定；
   Web 用 Vite 代理，App 用 CapacitorHttp 直连。**新增上游只需改 `upstreams.js`**。
2. **音源策略**：`config.defaultSource='bili'`；单曲偏好存 `bmp:source-pref`；
   点播时自动匹配，**匹配不到不自动回退 QQ**（提示并停）；失败匹配 5 分钟冷却。
3. **图片**：B 站封面走 `/img-api`（防盗链），QQ 封面直连；`AppImage` 失败自动重试 1 次；
   占位用 1×1 透明像素 + CSS 音符底色（空 `src` 会被画"裂图"图标）。
4. **登录三条路**：扫码 / 网页登录（能拿 `qm_keyst`）/ 手动 Cookie（书签小工具 + 剪贴板自动拾取）；
   **一键登录不可用**（源码级结论，实验开关保留但默认关）。
5. **「我喜欢」不是普通歌单**：`fcg_user_created_diss` 会混在"创建的歌单"里返回，特征是 `dirid=201`
   （`tid` 是 dissid）；API 层 + 缓存恢复 + `createdPlaylists` 三处排除。
6. **安全模型**：默认只绑 `127.0.0.1`；局域网模式强制一次性口令（HttpOnly Cookie + 常量时间比较 + 限流）。
7. **存储键**：全部 `bmp:` 前缀 —— `config`/`matches`/`user`/`userdata`/`source-pref`/`queue`/`history`/
   `lyric-offset`/`lyric-view`/`desktop-lyric`/`search-history`/`downloads`/`local-music`/`listen-stats`/
   `accounts`/`mini-player`/`lyric4:<mid>`。
8. **z-index 分层**：播放器 80 < `.overlay` 90 < `.unlock-overlay` 95 < toast 100。
9. **测试即约定**：见第 7 节。
10. **队列是播放顺序的唯一依据**：`state.queue` + `player.queueIndex`；`player.index` 仅表示当前曲在主列表的
    行号（-1 = 不在当前列表）；`expandPlayer()` 要同时认 `queueIndex`；播放/切歌按钮禁用条件用 `state.queue.length`。
11. **状态层与接口层按域拆分**：源码级测试守卫读取整个目录（新增文件自动纳入）；barrel 保持原导入路径。
12. **最近播放是纯本地数据**：`bmp:history`（上限 200，音源真正开始播放时记录，去重上移）；
    历史页播放走 `playLocalQueue()`。
13. **睡眠定时不持久化**；到点 `pause()`。
14. **入口必须动态导入 App / router**（`main.js`）：静态导入会让 store 模块级副作用在 `initPlatform()`
    之前发请求，绕过原生拦截器打到 `https://localhost` 404（平台测试有守卫）。
15. **歌词（行级）**：只对真实 QQ 歌曲（有 `songmid`）发请求；翻译走 musicu `PlayLyricInfo` + `trans:1`；
    musicu 空时回退旧接口；`mergeTranslation` 过滤 `//` 占位与**版权行**（`TME/享有本翻译作品…`）。
16. **歌词同步**：歌词时间轴来自 QQ 原曲，B 站音源可能前奏/版本差异 → 手动校准 `bmp:lyric-offset`
    （**正偏移 = 歌词延后**）；iframe 兜底用 `t=` 重载定位；rAF `smoothTime` 插值（外推 ≤0.5s）。
17. **全屏播放器默认歌词**：`state.ui.showLyrics`（`bmp:lyric-view`，默认开）。
18. **App 原生媒体控制 + 悬浮窗**：音频仍在 WebView `<audio>`；`MediaControlService` 承载 MediaSession +
    前台服务 + 通知 + 悬浮窗（App 前台自动隐藏）；拖拽监听只能挂歌词文字区（挂卡片根会吃掉按钮点击）；
    日志 TAG `BMP-Media`。
19. **布尔偏好一律 JSON 布尔持久化**（`'1'/'0'` 会被 `JSON.parse` 成数字导致判断失效）。
20. **Android WebView localStorage 异步落盘**：写完立刻 force-stop 可能丢数据（先 HOME 等几秒）。
21. **歌词校准只保留配置过的歌曲**（独立 map，不随歌词缓存清理）；长按连续调整有节流。
22. **进度条 seek 稳定性**：`seek()` 直接把插值基准设为目标时间；缓冲期保持目标（`shouldIgnoreStaleTimeUpdate`
    + `audioEl.seeking`，20s 硬上限，`seeked` 收尾）；原生 `onSeekTo` 先乐观更新 session + 通知再 dispatch；
    `setPointerCapture` 要 try/catch。
23. **通知栏动作图标用自绘矢量**（系统位图在 Flyme 主题化后带深色底）。
24. **FGS 竞态**：无歌时 `mediaSession.push()` 会调 `mediaControlClear()` → `stopService` 与
    `startForegroundService` 竞态 → `ForegroundServiceDidNotStartInTimeException` 崩溃。
    修复：`hadSong` 标记（启动无歌不发 clear）+ `MediaControlService.onCreate` 开头 `startForegroundCompat()`。
25. **写操作通道（P4 关键成果）**：musicu 新增类写操作一律 **80105** → 改走**签名网关**
    `u.y.qq.com/cgi-bin/musics.fcg?_=<ms>&sign=<zzc>`（`src/core/zzcSign.js`）；`writeCall` 统一
    票据守卫（`canWrite` 查 `qm_keyst`/`qqmusic_key`）+ 网关/业务/`retCode` 错误映射。
26. **写操作矩阵**：D1 红心（`PlaylistDetailWrite/AddSonglist|DelSonglist` `dirId=201`）、
    D2 专辑（`AlbumFavWrite/FavAlbum|CancelFavAlbum` `{v_albumId:[数字id]}`）、
    D3 歌单（`PlaylistFavWrite/FavPlaylist|CancelFavPlaylist` `{uin:euin,v_playlistId:[disstid]}`）、
    D4 创建（`PlaylistBaseWrite/AddPlaylist` → `result{dirId,tid}`）、D6 删除（`DelPlaylist{dirId}`）、
    D7 加/删歌（`v_songInfo:[{songId,songType}]`，≤50/批 + 500ms，`existed` 去重）。
    **D3 读取必须用 musicu `PlaylistFavRead/CgiGetPlaylistFavInfo`**（`{uin:euin,offset,size}`，
    响应字段 **`v_list`**，id 取 `tid`）：旧接口 `fcg_get_profile_order_asset` **不反映 `FavPlaylist` 写入**
    （2026-09-25 UI 复验发现，收藏态会 6 秒后回滚）；D2 读取 `AlbumFavRead/CgiGetAlbumFavInfo`。
    D5 改名 / D8 云历史 / D9 关注歌手 ⏸（负结论见 ROADMAP 第 5 节）。
27. **逐字歌词（QRC）+ 罗马音**：musicu `PlayLyricInfo` 一次请求 `crypt:1,qrc:1,roma:1,trans:1` →
    响应是 **hex 加密**（QQ 变体 3DES + zlib，XML `<Lyric_1 LyricContent="…"/>`）。
    `src/utils/qqc3des.js`：MIT 参考实现（WXRIW/QQMusicDecoder）的等价 JS 移植；`DecompressionStream`
    对 8 字节分组填充做 0–8 字节截断重试（否则报 trailing junk）；`write/close` 的 rejection 必须吞掉。
    `src/utils/qrc.js`：`extractQrcText`（XML 实体/原生换行）、`parseQrc`（词时间为**绝对毫秒**，
    空格是独立单元，`[offset:]` 处理）、`mergeQrcExtra`（翻译是 LRC、罗马音是 QRC，两种都尝试）、
    `wordState`（当前词 + 词内进度）、`markCreditLines`（QRC 开头「歌名 - 歌手」计时有词行标记 `credit`，
    弱化且不参与卡拉 OK）。`fetchLyric` 解密失败自动回退明文 LRC（`format:1` → 旧接口）。
    缓存 `bmp:lyric4:`（旧版本启动清理；缓存命中时补 credit 标记）。UI 仅 NowPlaying：当前行按词渲染
    （已唱词实色 + 当前词 `--wp` 渐变）、罗马音行、「逐字/罗马音」开关
    （`bmp:config.lyricQrc` 默认开、`lyricRoma` 默认关）。
28. **下载与离线**：原生持久目录 `Directory.Data/bmp-downloads`（**不随 Cache 清理**）+
    `bmp-local-music`；`resolveDownloadUrl` 按音源偏好解析（QQ 直链 / B 站音频流，失败回退另一侧）；
    播放优先命中本地（`source='local'`，seek 可用）+ 播放器「本地播放」徽标；批量并发 2 + 失败重跑
    （无断点续传）；Web 隐藏下载入口；`/storage` 统计/清理/导入；**飞行模式实测通过**（离线冷启动 →
    本地播放 + seek；无匹配歌曲优雅降级内嵌播放并提示）。
29. **听歌报告（纯本地）**：`api/stats.js` 纯函数 + `store/stats.js`（播放开始记事件、timeupdate 累积、
    4s 延迟落盘 + 暂停/切歌/释放 flush）；`bmp:listen-stats` 上限 5000；`/report` 页（7/30/全部、Top10、
    24 小时、每日趋势）；口径：播放次数 = 开始播放次数，时长 = 实际播放秒数。
30. **导入导出**：`api/transfer.js`（JSON `bmp-playlist` v1 / m3u；本地条目 `bmp://local`）+
    `core/files.js`（App 写 `Directory.External/bmp-exports`，Web Blob 下载）。
    **Capacitor `writeFile` 的字符串 `data` 默认按 base64 解码，文本必须显式 `encoding:'utf8'`**（否则乱码）。
    导入 = 解析 → `fetchTracksByMids`（musicu `music.trackInfo.UniformRuleCtrl/CgiGetTrackInfo`，
    写歌单需要**数字 songId**）批量补 id → 无 mid 条目搜索补全 → 二次确认 → `AddPlaylist` + `AddSonglist`。
31. **多账号**：`bmp:accounts`（最多 5，按 uin 去重、最新在前）；切换复用 `loginWithCookie`
    （清残留/重载/体检）；凭证只存本机。
32. **主题**：`<html data-theme="light|dark">` + CSS 变量双套；`store/theme.js`（`resolveTheme` 纯函数、
    system 监听 `prefers-color-scheme`）；`bmp:config.theme`。
    **`bmp:config` 默认值必须与已存配置合并**（`loadConfig()`）——否则老用户拿不到新字段默认值
    （P8.4 踩过：逐字默认开失效）。
33. **迷你播放器 / 小组件（仅 App）**：复用 `MediaControlService`（迷你卡与桌面歌词**互斥**、
    App 可见时隐藏、拖动位置记忆 `miniX/miniY`）；小组件 `MiniWidgetProvider`（4x1，按钮走服务
    `ACTION_TOGGLE/NEXT`，状态快照写 `bmp-overlay` 供 `onUpdate` 恢复）。
34. **付费受限（G2）**：`parseSongUrlInfo`（`purl` → 可播；空 + `result=104003` → `vip_required`；
    空 → `copyright_unavailable`；其它码 → `url_unavailable`）；`payplay`/`hasPreview` 从搜索/歌曲数据带出；
    UI 用 `data-vip` + CSS `::after` 标注（**不污染 textContent**，测试精确比对歌名）；回退原因细化
    （会员/VIP/无直链/获取失败分别提示）。
35. **UI 约定（2026-09-25 优化后）**：
    - 移动端歌曲行常显仅 `♥ + ⬇(可用时) + ⋯`，次要操作（重新匹配/加入歌单/下一首/B站/移除）进
      `ActionSheet`（`openActionSheet({title,items})`）；桌面端保持 hover 按钮；
    - `.bili-link` 移动端隐藏：`.icon-btn` 是 `display:grid`，图标 + 文字在窄列会**上下堆叠**；
    - 移动端隐藏 `.t-match`（B 站匹配标题）统一行高；`.rk-row` 页面（榜单/日推/FM/歌手/专辑）
      暂无行内下载/更多入口（已知）；
    - 播放页底部 `.np-act` 单行圆形图标；歌词工具条合并为一行 `.lyric-tools`
      （**保留 `.lyric-calib`/`.calib-btn`/`data-delta`/`.desktop-lyric-btn` 类名以兼容测试**）；
    - 顶栏「歌单内筛选 + 已匹配 + 一键匹配」仅在歌单页（`/`）显示；
    - 歌单头部移动端收敛为「播放全部 + 一键匹配 + 更多」（`hdr-desktop`/`hdr-mobile`）；
    - 播放/暂停圆钮用**中性反色**（底 `var(--text)` / 图标 `var(--bg)`，空队列为 `var(--hover)` 灰底弱图标）；
      桌面歌词开关用专用 `desktopLyric` 显示器图标，迷你播放器保留 `floatLyric`；
    - `.rk-row` 页面（榜单/日推/FM/歌手/专辑）统一走 `TrackActions`：桌面 播放/下一首/更多，
      移动端 喜欢/下载/更多（ActionSheet：重新匹配/加入歌单/下一首播放/打开 B 站）；
    - 歌词逐字（2026-09-27 重构）：拆 `LyricLine.vue`（仅当前行响应时间）；配色统一
      （未唱灰 / **已唱品牌绿** / 当前词绿扫过，0.1% 精度，无「唱完跳白」）；iframe 内嵌源
      用本地外推（`utils/lyricClock.js` + `store/lyric.js` 的 `lyricNow`，≤480ms）消除 2Hz 台阶；
      桌面歌词悬浮窗同步为「当前词绿→浅绿」混合；
    - 搜索页（2026-09-27）：历史 chip 支持单条删除（×）；热搜「换一换」按 12 条窗口从 30 条里循环轮换（不发新请求）；
    - 网页登录页默认展示「快捷登录」二维码（不再自动切密码表单，页面底部可手动切）。
36. **登录健壮性（2026-09-26，F1–F3）**：扫码轮询失败不再「一错即停」——连续失败自动重试
    （`POLL_RETRY_MAX=5`），超过上限才落错误态；二维码生成失败自动退避重试（`START_RETRY_MAX=3`），
    英文报错统一映射为中文（`src/utils/loginRetry.js` 纯函数，覆盖 `Failed to fetch` 与原生
    `Unable to resolve host` / `Network is unreachable` 等 CapacitorHttp 文案）；
    `visibilitychange` 回前台立即补轮询，终态（网络连续失败已停止）也能自动复活一轮
    （App 被 Flyme 冻结后的空窗）；请求超时 start 45s / poll **60s**
    （必须大于服务端换票最坏时长，否则中途 abort 会出现「已换票但会话被删」的假失效）。
37. **P5 评论与社交（2026-09-26 收尾）**：评论**写**走签名网关
    `music.globalComment.CommentWriteServer/AddComment|DelComment`（与 P4 同一 zzc 通道，
    2026-09-26 探测确认可达）；发表后刷新列表校准，`uin/euin` 匹配才显示「删除」；
    **点赞方法名未找到**（未实现）。分享 = 链接构造（`utils/share.js`）+ `qrcode` canvas 二维码 +
    `@capacitor/share` 系统分享（App；Web 隐藏）。E5 只落地**关注歌手只读**（`GetFollowSingerList`，
    设置页按需加载）；好友列表 `GetFriendList` code 1001 不可用；E4 一起听候选模块均 500003 → 不做。

---

## 6. 常量与接口速查

| 常量 / 接口 | 值 |
|---|---|
| QQ 登录 `APPID` / `DAID` / `PT_3RD_AID` | 716027609 / 383 / 100497308 |
| `REDIRECT_URI` | `https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/` |
| 登录域名 | `https://xui.ptlogin2.qq.com`（旧 `ssl.ptlogin2.qq.com` 对本 appid 403） |
| 「我喜欢」目录号 | `dirid = 201` |
| 会话 TTL | 10 分钟（服务端定时 sweep） |
| 签名网关 | `POST /qqmu-api/cgi-bin/musics.fcg?_=<ms>&sign=<zzcSign(body)>`（写操作专用） |
| 搜索（C 类） | `c.y.qq.com/soso/fcgi-bin/search_for_qq_cp`（t=0 单曲 / t=8 专辑）+ `client_music_search_songlist`（JSONP 剥壳） |
| 热搜 | musicu `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile`（`gethotkey.fcg` 被 WAF 500） |
| 榜单 | musicu `musicToplist.ToplistInfoServer` `GetAll` / `GetDetail` |
| 广场 | `fcg_get_diss_tag_conf.fcg` + `fcg_get_diss_by_tag.fcg`（`sin`/`ein` 闭区间） |
| 日推 / FM | musicu `music.recommend.TrackRelationServer/GetRadarSong`（每页 10 首、`HasMore`；`get_radio_track` 不可用） |
| 歌单详情 | musicu `music.srfDissInfo.DissInfo/CgiGetDiss`（旧 `fcg_ucc_getcdinfo_byids_cp` 已失效） |
| 专辑 | musicu `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail`（参数名 **`albumMId`**）+ 旧 `fcg_v8_album_info_cp.fcg` 取歌 |
| 歌曲信息 | musicu `music.trackInfo.UniformRuleCtrl/CgiGetTrackInfo`（`{mids,types}` → `id/name/singer/interval`） |
| 歌词 | musicu `music.musichallSong.PlayLyricInfo/GetPlayLyricInfo`（明文 `format:1,trans:1`；逐字 `crypt:1,qrc:1,roma:1,trans:1` 加密）；旧 `fcg_query_lyric_new.fcg` 兜底 |
| vkey 直链 | musicu `vkey.GetVkeyServer/CgiGetVkey`；受限码：`purl` 空 + `result=104003` → 需登录/会员 |
| 评论 | `c.y.qq.com/.../fcg_global_comment_h5.fcg`（`cid=205360772&biztype=1&cmd=8`） |

---

## 7. 测试

| 套件 | 命令 | 覆盖 |
|---|---|---|
| 平台层 | `npm run test:platform` | core/platform 纯逻辑、路由改写、base64、平台守卫、Referer 白名单、LRC/QRC 解析、**QRC 3DES 解密（真实加密 payload fixture）**、歌词偏移、seek 纯函数、下载/导入导出纯函数、主题解析、**登录重试策略与错误文案（F1–F3）**、原生源码守卫 |
| e2e | `npm run test:e2e` | 纯 Node 逻辑 + 本地服务接口 + 源码级回归守卫 + 运行时 store 用例（队列/历史/睡眠/歌词/校准/偏好/写操作/收藏/下载/统计/导入导出/账号/主题/迷你播放器守卫/**登录重试守卫**）+ mock 脚手架 |
| UI 桌面 | `npm run test:ui` | 未登录态渲染、弹窗、口令流程 |
| UI 桌面+演示 | `npm run test:ui:demo` | 登录态全流程（播放/匹配/音源/封面/队列/历史/歌词/**逐字+罗马音**/榜单/广场/日推/FM/歌手/专辑/详情/红心/歌单管理/收藏/下载/**存储页**/**报告页**/**导入导出**/**账号**/**主题**/**登录健壮性（离线 mock）**/顶栏语境化） |
| UI 移动 | `npm run test:ui:mobile` | 移动布局、抽屉、迷你播放条 |
| UI 移动+演示 | `npm run test:ui:mobile:demo` | 移动端全流程 + **「更多」动作面板** + 歌单头部收敛 + seek 不回弹等 |

**测试约定（重要）**

- 用**独立端口 5199** 起服务，`BMP_URL='http://127.0.0.1:5199'` 传给测试；
- **只杀自己启动的 PID**（pid 写 `$env:TEMP\bmp-test-server.pid`），**绝不按端口杀进程**；
- 网络噪声过滤：`401/404/500/502/503/504`、`超时`、`Failed to fetch` 计入"已忽略"并打印计数；
- 演示模式（`--demo`）**必须完全不依赖外网**；哨兵地址 `/bmp-broken-cover-test.png` 专门验证占位逻辑；
- 写操作**绝不真写**：e2e/demo 全部走 mock transport / CDP Fetch mock；
- **长会话后重启 5199**（Vite 模块缓存过期会报 `does not provide an export named ...`）；
- B 站 media-api 两条用例限流时会间歇 FAIL（重跑）。

---

## 8. 构建与发布

```bash
npm run build                    # Web
npm run cap:sync                 # = build:android（base:'./'）+ cap sync
cd android && ./gradlew assembleDebug
```

- **必须用 JDK 21 出包**：将 `JAVA_HOME` 指向本机的 JDK 21（Android Studio 自带 jbr 若是 Java 25，
  Gradle 8.14.3 会报 `Unsupported class file major version 69`）；
- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`；
- **命名约定**：复制为 `bili-music-player-v<版本>.apk`（当前 `v1.0.0`），放 `release/`（gitignore）；
- `android/.gitignore` 已忽略 `app/src/main/assets/public` 与 `capacitor.config.json`；
- 工具链 / 设备 / 代理细节见 `HANDOVER-LOCAL.md`。

---

## 9. 真机验证状态（Android 真机）

已通过真机验证。为避免公开账号信息与受版权保护素材，仓库不提交真机截图。


未做 / 需手动的验证项：

- **H3 小组件「拖到桌面」**：provider 注册与状态推送已验证（`dumpsys appwidget` + `bmp-overlay` 快照；
  2026-09-26 复验：播放中快照 `widgetTitle/widgetArtist/widgetPlaying=true` 推送正确），
  添加到桌面是启动器手动步骤，仍未完成（需要时手动补验并截图）；
- **D2/D3 之外的写操作 UI**（创建/删除/加歌/删歌）已在真机验证过（P4），2026-09-26 导入歌单端到端时已回归
  （创建 → 加歌 → 删歌 → 删除，服务端读回、无残留）。

---

## 10. 已知问题与待办

| 优先级 | 项 | 说明 |
|---|---|---|
| ✅ | 登录健壮性（F1–F3） | **2026-09-26 已修复**：① 扫码轮询连续失败自动重试（上限 5 次，超出才报错并提供降级入口），网络抖动不再一错即停；② 二维码生成失败自动退避重试（3 次），英文报错统一中文（含原生 CapacitorHttp 文案）；③ `visibilitychange` 回前台立即补轮询、终态自动复活；另加请求超时（start 45s / poll 60s）防请求悬挂卡死轮询 |
| 中 | 网页登录页默认切到密码表单 | ~~2026-09-26 修复~~：`QqLoginActivity` 已停用自动切换，网页登录默认展示快捷登录二维码（底部可手动切密码登录） |
| 中 | 受限会话 | 扫码有时拿不到 `qm_keyst`（腾讯侧行为）→ 写操作 / 私密歌单不可用；用网页登录或手动 Cookie |
| ✅ | 开源前隐私清理 | **2026-09-26 已完成**：测试/注释/文档中的真实 QQ 号改假值（`10000`）、账号派生 fixture 通用化、含票据的本地截图移除、其余含昵称截图打码、公开文档去设备序列号；包名中性化为 `com.bilimusic.player`；版本统一 `1.0.0` |
| 中 | 依赖审计 | `npm audit` 当前报告 3 个 moderate（Capacitor CLI 的传递依赖 `xcode`/`uuid`）；仅影响开发/打包工具链，升级需要评估破坏性变更 |
| 中 | H3 小组件手动添加 | 见第 9 节；接手者可让用户手动加一次并截图 |
| ✅ | 移动端 `.rk-row` 页面无行内操作 | **2026-09-26 已修复**：统一接入 `TrackActions`（移动端 喜欢/下载/更多，ActionSheet 收次要操作） |
| ✅ | 逐字/罗马音未接悬浮窗 | **2026-09-26 已完成**：桌面歌词悬浮窗按词着色（Spannable）+ 罗马音行（迷你卡保持歌名/歌手） |
| ✅ | 版本号未统一 | **2026-09-26 已统一为 1.0.0**：`package.json` 为单一来源，Android `versionName` 由 Gradle 读取 |
| 低 | 受限码映射来源 | vkey 的 `104003` 等码值来自社区资料 + fixture 覆盖，未能用无会员账号穷举验证 |
| 低 | `alert()` 在书签小工具里 | 属正常（在 y.qq.com 上运行） |
| 低 | 评论点赞未实现 | 2026-09-26 多渠道探测（20+ 方法名 / 12 模块 / `CommentWrite.PraiseComment` 无实际效果）均未找到写通道；读侧 `ispraise` 字段存在。发/回复/删除已实现 |
| ⏸ | D5 歌单改名 / D8 云历史 / D9 关注歌手 | 负结论已记录（ROADMAP 第 5 节）；2026-09-26 复探：D8 4 个新候选、D9 写 4 个新候选均 500003，D5 参数矩阵仍 40000/1101（测试数据已清理）——需新的抓包/源码线索才能继续 |

---

## 11. 常见故障排查

| 现象 | 排查 |
|---|---|
| 所有接口 `Failed to fetch` | 诊断第 0 项「本地服务连通性」；确认通过 `http://localhost:5173` 打开而不是双击 `dist/index.html` |
| 局域网模式全部 401 | 未解锁，输入终端里打印的口令 |
| 登录报 `Unable to resolve host` | 设备 DNS 解析不了 `xui.ptlogin2.qq.com`：检查 VPN / 私人 DNS / 去广告 DNS；或改用手动 Cookie |
| 写操作报「上游拒绝」/ `80105` | 检查是否登录且有 `qm_keyst`（`canWrite`）；重新登录（网页登录/手动 Cookie）；确认走的是签名网关 |
| 收藏歌单后状态回滚 | 读路径必须是 musicu `PlaylistFavRead`（`v_list`）；旧接口不反映写入（第 5 节第 26 条） |
| 歌词没有逐字 | 该歌可能没有 QRC；确认 `GetPlayLyricInfo` 返回 hex（`looksLikeQrcHex`）与解密成功；缓存为 `bmp:lyric4:` |
| 离线无法播放 | 确认已下载（`/storage` 列表）且播放时出现「本地播放」徽标（`source='local'`） |
| 卡片/边框样式缺失 | CSS 变量 `--card/--line/--hover/--accent` 已在 `:root` 定义（曾缺失导致 `var()` 无效） |
| 新增配置项对老用户不生效 | `state.js` 的 `loadConfig()` 必须与 `CONFIG_DEFAULTS` 合并 |
| 播放失败 | 三级回退：QQ 直链 → B 站音频（`/media-api` 带 Referer）→ 内嵌 iframe；离线时 iframe 会提示不可拖动 |
| 真机 CDP `Runtime.evaluate` 不返回 | 屏幕 Doze / App 后台冻结：`input keyevent 26` 唤醒 + `wm dismiss-keyguard` + `am start`/`monkey` 切前台；测试期间可 `svc power stayon true`（用完恢复） |
| 测试报模块导出缺失 | 重启 5199 测试服务（Vite 模块缓存过期） |

---

## 12. 提交历史要点（近期）

- `7e98548` UI 优化（二）：顶栏语境化 + 歌单头部移动端收敛 + 联想下拉
- `509eaa4` UI 优化（一）：歌曲行瘦身（ActionSheet）+ 播放页压缩 + 歌词 credit/版权行
- `f29bf8b` 逐字歌词 / 罗马音（P8.4，QRC 3DES 解密 + 卡拉 OK 渲染）
- `2d51ba5` P6.3 飞行模式离线播放真机实测
- `16bd052` D3 读路径修复（`PlaylistFavRead`/`v_list`）+ D2/D3 真机 UI 复验
- `4ccc4cf` P9.1 识曲 spike 结论（不做）
- `c320bb3` / `b66a187` / `14db061` P8.3 小组件 / P8.2 迷你播放器 / P8.1 主题
- `9f166de` / `9e352aa` / `a8424cc` / `1c5e8c4` P7 多账号 / 导入导出 / 听歌报告 / 付费受限
- `7be914b` P6 下载与离线
- `36da7b5` / `57debdf` / `6160ecd` / `255685a` P4 收藏专辑歌单 / FGS 修复 / 签名网关 / 写基础设施+红心
- `2e6fc95` / `21e5dff` / `0cae7c7` / `28a5841` / `53f1f80` / `7703cfd` / `4766b43` / `618c787` P3 各页
- `598ade2` P0–P2（队列/历史/睡眠/媒体控制/歌词/桌面歌词）
- 更早：`563eeb9`、`9d6a71e`、`b39ca87`、`0b0934f`、`abdbfd3`、`aed759b` 等

---

## 13. 交接清单（新接手第一步）

1. `git status` / `git log --oneline -5`：应在 `main`，与 `origin/main` 同步、工作区干净；
2. `npm install` → 按第 3 节起 5199 测试服务 → 依次运行平台/安全/e2e/UI 测试，核对第 2 节基线；
3. 通读 `ROADMAP.md`：**第 5 节接口验证记录**（哪些接口可用/已失效/负结论）、
   **第 6/7 节进度与基线**、变更记录里的踩坑；
4. 若要动真机：按 `HANDOVER-LOCAL.md` 准备 adb / JDK / 代理，用 `scripts/android-cdp.mjs` 调试 WebView；
5. 优先可做（按价值排序）：
   ① ~~登录健壮性 F1–F3~~（**2026-09-26 已完成**，见第 5 节第 36 条与第 10 节）；
   ② H3 小组件手动添加验证 + 截图；
   ③ ~~桌面歌词接入逐字/罗马音~~（**2026-09-26 已完成**）；
   ④ ~~移动端 `.rk-row` 页面补行内「更多」入口~~（**2026-09-26 已完成**，统一 `TrackActions`）；
   ⑤ ~~开源前清理（QQ 号/包名/作者信息）+ 版本号统一~~（**2026-09-26 已完成**，含包名中性化 `com.bilimusic.player`）；
   ⑥ D5/D8/D9 与 P9 需要新线索（D5/D8/D9：抓包环境已备但 QQ 音乐手机版 arm64-only 装不上，
      见 ROADMAP 设备记录；源码路线 `L-1124/QQMusicApi` 已排查无实现）。
      P9 识曲：候选模块 500003、无公开后端；如要落地需 ACRCloud 自备凭证或抓到 QQ 私有接口。
