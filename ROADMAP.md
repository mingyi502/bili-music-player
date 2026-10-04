# ROADMAP — QQ 音乐能力扩展

> 基线：分支 `feat/android`，起始提交 `563eeb9`
> 配套：`HANDOVER.md`（项目交接）、`HANDOVER-LOCAL.md`（本机环境，不入仓）
> 本文件是功能扩展的**唯一进度事实来源**：每完成一个工作项，更新状态与验收证据。

## 0. 目标与原则

- 目标：从「歌单导入 + B 站匹配播放」扩展为覆盖 QQ 音乐大部分日常能力的播放器。
- **音源策略（已定）**：保持 B 站为主 —— C 类页面（搜索/榜单/歌手/推荐等）的播放走现有匹配流程；
  QQ 直链仍为单曲可选源；QQ 直连不可用（VIP/付费/无版权）时按 G2 提示并回退。
- **平台策略（已定）**：两端共享；`A11 / B4 / F4 / H2 / H3` 仅 Android App 提供入口，Web 隐藏。
- **合规**：不绕过任何付费/版权限制；付费 / VIP 内容只做「受限提示 + 试听」。
- 每个工作项必须：独立可验收、保持 6 套测试基线全绿、demo 模式零外网。
- 写操作（D 类 / E2）**不进自动化测试**（避免污染真实账号）：mock 单测 + 手动验收清单。
- 高风险项（E4 / E5 / C11）先做调研 spike，可行才实现，不可行记录结论后放弃。

## 1. 状态图例

`⬜ 未开始` · `🟡 进行中` · `✅ 已完成` · `🚫 已放弃（附原因）` · `🔬 调研中` · `⏸ 暂停（待新线索）`

## 2. 功能总表

> 难度：低 / 中 / 高（高 = 需原生插件、实时协议或逆向验证）

| 编号 | 功能 | 现状 | 难度 | 阶段 | 状态 | 依赖 |
|---|---|---|---|---|---|---|
| A2 | 播放队列（下一首播放 / 排序 / 清空） | ✅ | 中 | P1 | ✅ | P0 |
| A3 | 播放历史（最近播放） | ✅ | 低 | P1 | ✅ | P0 |
| A6 | 睡眠定时 | ✅ | 低 | P1 | ✅ | P0 |
| A11 | 通知栏 / 锁屏 / 蓝牙按键控制（仅 App） | ✅ | 中 | P1 | ✅ | P0 |
| B1 | 滚动歌词（LRC + 翻译） | ✅ | 中 | P2 | ✅ | P0 |
| B1b | 逐字歌词（QRC）/ 罗马音 | ✅ | 中 | P8.4 | ✅ | B1 |
| B3 | 全屏歌词页 | ✅ | 中 | P2 | ✅ | B1 |
| B4 | 桌面歌词悬浮窗（仅 App） | ✅ | 高 | P2 | ✅ | B1 |
| C1 | QQ 音乐综合搜索 | ✅ | 中 | P3 | ✅ | P0 |
| C2 | 搜索联想 / 热搜榜 / 搜索历史 | ✅ | 低 | P3 | ✅ | C1 |
| C3 | 排行榜（TOP500/飙升/新歌/热歌…） | ✅ | 中 | P3 | ✅ | P0 |
| C4 | 歌单广场（分类 / 推荐歌单） | ✅ | 中 | P3 | ✅ | P0 |
| C5 | 每日推荐 | ✅ | 中 | P3 | ✅ | P0、登录 |
| C6 | 私人 FM | ✅ | 中 | P3 | ✅ | P0、登录 |
| C7 | 歌手页（热门 / 专辑 / 简介） | ✅ | 中 | P3 | ✅ | P0 |
| C8 | 专辑页增强（播放全部 / 收藏） | ✅ | 低 | P3 | ✅ | P0、D2 |
| C11 | 听歌识曲（仅 App） | ⛔ | 高 | P9 | ⛔ | spike（结论：不做，见 P9.1） |
| C12 | 歌曲详情页（评论 / 相似推荐） | ✅ | 中 | P3 | ✅ | E1、E2 |
| D1 | 喜欢 / 取消喜欢歌曲 | ✅ | 中 | P4 | ✅ | P4.0 |
| D2 | 收藏 / 取消收藏专辑 | ✅ | 中 | P4 | ✅ | P4.0 |
| D3 | 收藏 / 取消收藏歌单 | ✅ | 中 | P4 | ✅ | P4.0 |
| D4 | 创建歌单 | ✅ | 中 | P4 | ✅ | P4.0 |
| D5 | 编辑歌单（名称/简介/标签/封面/公开性） | ⬜ | 中 | P4 | ⏸ | P4.0 |
| D6 | 删除歌单 | ✅ | 中 | P4 | ✅ | P4.0 |
| D7 | 歌单内加歌 / 删歌 / 排序 | ✅ | 中 | P4 | ✅ | P4.0 |
| D8 | 云端「最近播放」同步 | ⬜ | 中 | P4 | ⏸ | A3 |
| D9 | 关注 / 取消关注歌手 | ⬜ | 中 | P4 | ⏸ | P4.0 |
| E1 | 评论列表（热评/最新、分页） | ✅ | 中 | P5 | ✅ | P0 |
| E2 | 发评论 / 回复 / 点赞 / 删除 | ✅（点赞未实现：写通道未找到） | 中 | P5 | ✅ | E1 |
| E3 | 分享（链接 / 二维码 / 卡片） | ✅ | 低 | P5 | ✅ | P0 |
| E4 | 一起听 / 歌单协作 | ⛔ | 高 | P5 | ⛔ | spike（结论：不做，见第 5 节） |
| E5 | 好友动态 / 关注流 | ✅（仅关注歌手只读） | 高 | P5 | ✅ | spike（好友动态不可用，见第 5 节） |
| F1 | 单曲下载（选音质 / 进度 / 重试） | ✅ | 中 | P6 | ✅ | P0.3 |
| F2 | 批量下载歌单 | ✅ | 中 | P6 | ✅ | F1 |
| F3 | 离线播放模式 | ✅ | 中 | P6 | ✅ | F1 |
| F4 | 本地音乐导入（仅 App） | ✅ | 中 | P6 | ✅ | P0 |
| F5 | 缓存管理页 | ✅ | 低 | P6 | ✅ | P0 |
| G1 | 用户资料 / VIP 状态 | ✅ | — | — | ✅ | — |
| G2 | 付费受限识别（试听片段提示 + B 站回退） | ✅ | 中 | P7 | ✅ | P0.3 |
| G3 | 多账号切换 | ✅ | 低 | P7 | ✅ | P0 |
| G4 | 听歌报告 / 统计（本地） | ✅ | 中 | P7 | ✅ | A3 |
| G5 | 歌单导入导出（JSON / m3u） | ✅ | 低 | P7 | ✅ | P0 |
| H1 | 深色 / 主题模式 | ✅ | 低 | P8 | ✅ | P0 |
| H2 | 迷你播放器 / 桌面悬浮（仅 App） | ✅ | 高 | P8 | ✅ | P0 |
| H3 | 桌面小组件（仅 App） | ✅ | 高 | P8 | ✅ | P0 |

## 3. 阶段与工作项

> 每项格式：目标 / 接口 / 涉及文件 / 验收 / 测试。
> 接口标注 `[已验证]` / `[待抓包验证]`，验证记录见第 5 节。

### P0 基础设施（不改 UI 行为）

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P0.1 | 路由骨架 | 引入 `vue-router@4`（hash 模式，兼容 Capacitor 相对路径）；`src/router/index.js`；`src/App.vue` 内容区改 `<RouterView>`；保留全部全局弹层与滚动逻辑 | 现有页面行为不变 | 6 套基线 |
| ✅ P0.2 | musicu 统一封装 | `src/api/qq/comm.js`：`buildComm` / `buildWriteComm`（g_tk 签名）/ `postMusicu` / `musicuCall` / `musicuError`（1000=未登录）；`src/api/qq.js` 三处 musicu 调用改走新封装 | 现有 musicu 调用行为不变 | 平台层 + e2e |
| ✅ P0.3 | 白名单与 Referer 修复 | `upstreams.js`：QQ CDN（`*.stream.qqmusic.qq.com` / `*.tc.qq.com`）加入 `MEDIA_HOST_ALLOW`，新增 `REFERER_BY_HOST` + `refererForHost()`；`native/media.js` 音频下载按域名选 Referer；`server/image-proxy.js` 图片/音频代理按域名选 Referer | QQ 音频经 `/media-api` 可播放 / 可下载 | 平台层（+8 断言） |
| ✅ P0.4 | api 拆分 | `src/api/qq.js` 拆为 `src/api/qq/{comm,util,user,song,playlist,album,index}.js`；`qq.js` 变兼容 barrel；e2e 源码守卫改为读取整个 `qq/*` | 原导入路径全部可用 | 6 套基线 |
| ✅ P0.5 | store 拆分 | `src/store/index.js`（1450 行）拆为 `state / ui / errors / access / player / library / user / diagnostics`，`index.js` 聚合导出 + `store` 对象；e2e 守卫改读整个 `store/*` | 原导入路径全部可用 | 6 套基线 |
| ✅ P0.6 | 测试脚手架 | `scripts/lib/mock-transport.mjs`（loadFixture / createMockTransport / parseMusicuBody，未命中即抛错）；`scripts/fixtures/qq/*.json`（vkey / 我喜欢 / 创建歌单 / 搜索）；e2e 新增脚手架自检 5 项 | fixture 驱动的接口测试可用 | e2e（+5 断言） |

### P1 播放器核心

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P1.1 | A2 播放队列 | 队列显式化：`state.queue` + `player.queueIndex`；`setQueueFromSongs` / `playNext` / `addToQueue` / `removeFromQueue` / `moveQueueItem` / `clearQueue` / `playQueueItem`；持久化 `bmp:queue`（上限 500）；`QueuePanel.vue`（拖动排序指针事件、清空、移除）+ PlayerBar/NowPlaying 入口 + SongRow 按钮 | 排序 / 下一首播放后播放顺序正确，刷新可恢复 | e2e（+13）+ UI demo（+7） |
| ✅ P1.2 | A3 播放历史 | 纯本地历史 `bmp:history`（上限 200，音源真正播放时记录、去重上移）；`recordHistory` / `clearHistory` / `playLocalQueue`（不改主列表）；`HistoryView.vue`（相对时间、本地队列播放、二次确认清空）+ `/history` 路由 + 侧栏「最近播放」入口 | 历史记录正确、可清空、与 QQ 账号数据无关 | e2e（+6）+ UI demo（+6） |
| ✅ P1.3 | A6 睡眠定时 | `state.sleep` + `setSleepTimer` / `cancelSleepTimer`（到点自动暂停、不持久化）；`SleepTimerButton.vue`（15/30/60/90 分钟 + 倒计时角标），PlayerBar / NowPlaying 入口 | 到时自动暂停 | e2e（+4）+ UI demo（+4） |
| ✅ P1.4 | A11 媒体控制（Web） | `src/store/mediaSession.js`：Media Session API（元数据标题/歌手/封面、play/pause/prev/next/seekto/seek±、`playbackState`、`setPositionState`），特性检测自动跳过不支持环境 | 系统媒体面板可控制 / 显示封面 | e2e（+2）+ UI demo（+2） |
| ✅ P1.4b | A11 媒体控制（App 原生） | `MediaControlPlugin` + `MediaControlService`：MediaSessionCompat（通知栏 / 锁屏 / 蓝牙按键）+ 前台服务（`mediaPlayback`）+ MediaStyle 通知（封面 / 三个动作 / 点击回 App）；JS 侧 `core/mediaControl.js` 注入点 + `native/mediaControl.js` + `mediaSession.js` 原生分支（状态推送 + 动作回传）；Android 13+ 通知权限只申请一次 | 真机：通知栏 3 动作、`keyevent 85/87` 播放暂停与切歌生效 | 平台层守卫（+6）+ e2e（+2）+ 真机 |

### P2 歌词

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P2.1 | B1 歌词获取与解析 | `[已验证]` `fcg_query_lyric_new.fcg`（LRC + `trans` 翻译，base64）；`src/api/qq/lyric.js`（`fetchLyric` / `decodeBase64Utf8`）+ `src/utils/lrc.js`（`parseLrc` / `mergeTranslation` / `findLineIndex`，含 `[offset:]` 与 50ms 翻译容差）；`src/store/lyric.js` 自动跟随当前曲、缓存 `bmp:lyric2:<mid>`（配额满自动清缓存重试） | 任意 QQ 歌曲可取到歌词与翻译 | 平台层（+14 解析单测）+ e2e（+8） |
| ✅ P2.2 | B3 全屏歌词页 | `NowPlaying` 改造：封面 ↔ 歌词（点封面/按钮切换、触屏左右滑）、当前行高亮 + 自动居中滚动、点行 seek、翻译行、无歌词/加载中占位、失败「重试」按钮 | 歌词滚动与播放进度同步 | UI demo（+4） |
| ✅ P2.3 | B4 桌面歌词 | 悬浮窗在 `MediaControlService` 内（`TYPE_APPLICATION_OVERLAY`，可拖动、位置持久化）；`store/desktopLyric.js`（`bmp:desktop-lyric` 开关 + 当前行/翻译推送 + 重启自动恢复）；未授权时引导系统设置；入口：歌词页 + 设置（Web 隐藏） | 真机：悬浮窗窗口存在、歌词与翻译实时推送、重启自动恢复 | 平台层守卫 + e2e（+2）+ UI demo（+1）+ 真机 |
| ✅ P2.3b | 桌面歌词体验优化 | 卡片改版：宽卡片（屏宽−48dp）+ 半透明圆角 + 当前行绿色 18sp / 翻译白色 13sp + 控制行（上一首/播放暂停/下一首/关闭）+ 图标资源；**App 前台自动隐藏、退后台/锁屏显示**（`handleOnStart/Stop` → `setAppVisible`）；卡片关闭按钮经 `overlayClosed` 事件同步开关；**通知栏升级**（进度条 + 第 4 个动作，**两态图标**：空心窗口 `ic_stat_lyrics_off` / 实心窗口 `ic_stat_lyrics_on`）；App 内开关改为**两行布局 + 文字两态**（`[窗口图标] 桌面歌词 · 已开启/未开启`，绿色填充 vs 灰色描边） | 真机：前台隐藏、通知进度推进、图标两态可辨、开关同步；**真机发现并修复「拖拽监听挂卡片根节点导致按钮点不到」** | 平台层守卫 + e2e 守卫 + 真机（真机按钮全部实测） |
| ✅ P1.1b | 移动端播放条队列入口 | ≤1080px 时 `.player-right` 仅保留队列按钮（隐藏睡眠/音源/B站/角标），播放条改三列；点击打开队列面板（带数量角标） | 手机播放条可直接打开播放队列 | UI demo（+1）+ 真机 |
| ✅ P1.1c | 进度条 seek 稳定性 | `src/utils/seek.js`（`shouldIgnoreStaleTimeUpdate`）+ `player.js`：seek 后插值基准**直接取目标**（不回读 `audioEl`）、**缓冲期间一律保持目标**（以 `audioEl.seeking` / 重试窗口为界，硬上限 20s，`seeked` 事件到达即收尾）、音频不再 seeking 时**重试一次** seek；rAF 未落定期间停在目标；两个进度条**拖动只预览、松手才提交**；`setPointerCapture` 加保护；**原生 `onSeekTo` 同毫秒乐观更新会话位置与通知进度**（不等 JS 往返，避免系统面板先弹回旧位置） | 真机：App 内 **141s 大跨度跳转** 70.02%→73.88% 单调递增无回落；通知栏点 70% → `onSeekTo` 乐观更新、JS 36ms 确认、session 位置稳定在 141853 后继续推进 | 平台层（+7）+ e2e（+5）+ UI demo（+2，可 SKIP）+ 真机 |
| ✅ P2.4b | 歌词校准增强 | 长按「提前/延后」连续调整（500ms 后每 150ms 一步）；落盘改 leading+trailing 节流（长按不刷盘）；B 站视频与原曲时长差 >5s 时提示「可能是不同版本」；校准按歌曲独立持久化（`bmp:lyric-offset`，缓存升级/清理不影响） | 长按 1.2s → +2.5s；旧歌校准保留 | 平台层（+3）+ e2e（+2）+ UI demo（+3）+ 真机 |
| ✅ P2.4 | 歌词同步修复（S1+S2+S3） | S1 手动校准：`bmp:lyric-offset`（正 = 歌词延后，±30s，`setLyricOffset`/`resetLyricOffset`）+ 歌词页工具条；S2 iframe 定位：`playerUrl(bvid,page,startSec)` 带 `t=`，`seek`/`resume` 重载 iframe（真机实测 `t=90` 生效）；S3 帧级插值：rAF `smoothTime`（外推 ≤0.5s、30ms 节流），`elapsed` 接入；另修复「重启恢复队列后播放键被禁用」（按钮判断改 `state.queue.length`） | 歌词与播放时间对齐、可手动校准、进度更跟手 | 平台层（+7）+ e2e（+10）+ UI demo（+5） |
| ✅ P2.5 | 全屏播放器默认歌词视图 | `state.ui.showLyrics`（`bmp:lyric-view` 持久化，默认开）；`setShowLyrics` / `toggleLyrics`；NowPlaying 的按钮/点封面/左右滑统一走持久化入口 | 默认歌词、切换后记住 | UI demo（+3） |
| ✅ P2.6 | 歌词翻译修复 | **根因**：老接口 `fcg_query_lyric_new` 不下发 `trans`（带登录态也为 0）；改为 musicu `music.musichallSong.PlayLyricInfo` + **`trans: 1`**（真机实测 27 行歌词 25 行带翻译），musicu 返回空时回退老接口；缓存升级 `bmp:lyric2:`（启动清理旧 `bmp:lyric:`）；过滤翻译里的 `//` 占位 | 日文歌显示中文翻译 | 平台层（+3）+ e2e（+2） |

### P3 搜索与发现

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| P3.1 | C1 综合搜索 | **musicu 搜索接口已失效**（`DoSearchForQQMusicDesktop` 全类型空表；`client_search_cp` 被 WAF 500）→ 改走 c.y.qq.com 经典 CGI：单曲/专辑 `search_for_qq_cp`（t=0/8）、歌单 `client_music_search_songlist`（JSONP 剥壳，`page_no` 0 基）、歌手无公开接口 → **从单曲结果聚合去重**（不做拼音/别名联想）；`src/api/qq/search.js`（纯函数解析）+ `src/views/SearchView.vue` + `src/store/search.js`（历史） | 四类结果可搜索、可翻页、可播放 / 跳转 | 平台层（+11）+ e2e（4a-11~4a-13）+ UI demo（+7）+ 真机 |
| ✅ P3.2 | C2 热搜 / 联想 / 历史 | **`gethotkey.fcg` 已 500（WAF）** → 热搜改 musicu `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile`（`vec_hotkey` 取 12 条，去重）；联想 `smartbox_new.fcg`（GET；单曲→歌手→专辑→MV 取 8 条；250ms 防抖 + 按词缓存）；搜索历史随 P3.1（`bmp:search-history`）；`SearchView.vue` 新增热搜榜区块与输入联想下拉（↑↓/Enter/Esc） | 输入联想与热搜可点、可搜索 | 平台层（+5）+ e2e（4a-12）+ UI demo（+2）+ 真机 |
| ✅ P3.3 | C3 排行榜 | **老接口已废**：`fcg_v8_toplist_index.fcg` 404、`fcg_v8_toplist_cp.fcg` 返回空 → 改 musicu `musicToplist.ToplistInfoServer`：`GetAll`（4 组 30 榜）+ `GetDetail`（`data.song[]` 排名条目与 `songInfoList[]` **按下标合并**；`period` 需用上游返回值重试一次）；`src/api/qq/rank.js` + `src/views/RankView.vue`（分组 Tab / 榜单卡片 / 播放全部 / 加载更多） | 榜单可浏览、整榜可播放 | 平台层（+6）+ e2e（4a-13）+ UI demo（+4）+ 真机 |
| ✅ P3.4 | C4 歌单广场 | `fcg_get_diss_tag_conf.fcg`（6 组分类 + 排序）与 `fcg_get_diss_by_tag.fcg`（**闭区间** sin/ein）均实测可用；`src/api/qq/square.js` + `src/views/SquareView.vue`（分组 Tab → 分类/排序 chips → 卡片墙 → 加载更多 → 点卡片打开歌单）；**顺带修复**：歌单详情老接口 `fcg_ucc_getcdinfo_byids_cp.fcg` 已返回空 `cdlist` → 迁 musicu `music.srfDissInfo.DissInfo/CgiGetDiss`（`src/api/qq/playlist.js`，分页拉全），恢复「粘贴歌单链接 / 搜索结果点歌单 / 广场点歌单」 | 分类切换、歌单可加载进播放列表 | 平台层（+7）+ e2e（4a-14）+ UI demo（+4）+ 真机 |
| ✅ P3.5 | C5 每日推荐 | QQ 无「每日 30 首」对应接口；`get_radio_track`（猜你喜欢）匿名出歌少且多为助眠白噪音 → 改用 **`music.recommend.TrackRelationServer/GetRadarSong`**（雷达，**匿名可用**，10 首/页 + `HasMore`）：循环取页、按 mid 跨页去重凑满 30 首；`src/api/qq/daily.js` + `src/views/DailyView.vue`（换一批 / 播放全部 / 未登录提示「登录后更懂你」）；登录后按口味个性化 | 可取得 30 首并播放（匿名/登录均可） | 平台层（+4）+ e2e（4a-15）+ UI demo（+2）+ 真机 |
| ✅ P3.6 | C6 私人 FM | 官方电台 `get_radio_track` **匿名与登录态都只出 1~3 首/次且默认「睡前」助眠白噪音** → FM 与每日推荐同源使用雷达（`fetchRadarPage`）；`src/api/qq/fm.js`（`fetchFmBatch`：跨页去重 + `exclude` 永不重复）+ `src/views/FmView.vue`：连续播放时**队列剩 ≤4 首自动补 10 首**（`appendToQueue` 批量入队不弹 toast）、每行「不喜欢」移除并补一首、换一批 | 连续出歌、不重复 | e2e（4a-17）+ UI demo（+3）+ 真机 |
| ✅ P3.7 | C7 歌手页 | 4 个 musicu 接口实测可用：`music.web_singer_info_svr/get_singer_detail_info`（详情 + 热门 + `singer_brief` 简介）、`musichall.song_list_server/GetSingerSongList`（单曲分页）、`music.musichallAlbum.AlbumListServer/GetAlbumList`（专辑分页）、`music.SimilarSingerSvr/GetSimilarSingerList`；`src/api/qq/artist.js` + `ArtistView.vue`（`/artist/:mid`：头像/粉丝/简介展开 + 热门/单曲/专辑/相似歌手四 Tab）；搜索歌手项改为进入歌手页 | 各区块可加载、可跳转、可播放 | 平台层（+6）+ e2e（4a-18）+ UI demo（+2）+ 真机 |
| ✅ P3.8 | C8 专辑页增强 | 旧接口 `fcg_v8_album_info_cp.fcg` 实测仍可用（歌曲列表沿用）→ 新增 musicu `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail`（**参数名 `albumMId`**）做元信息增强（译名/公司/流派/语种/简介）；`AlbumView.vue`（`/album/:mid`：封面/译名/发行日/公司/简介展开 + 播放全部 + 曲目）；入口统一改为专辑页（搜索 / 歌手页 / 侧栏收藏的专辑）；**收藏按钮留待 P4.2（D2 未实现）** | 专辑可播放、可跳转 | 平台层（+3）+ e2e（4a-19）+ UI demo（+2）+ 真机 |
| ✅ P3.9 | C12 歌曲详情页 | 相似歌曲 `music.recommend.TrackRelationServer/GetSimilarSongs`（**数字 songid**，`vecSong[].track`）；评论 `c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg`（`cid=205360772` / `biztype=1` / `topid=数字id` / `cmd=8`；热评 + 最新 + `commenttotal`）；`src/api/qq/songDetail.js` + `SongDetailView.vue`（`/song/:id`，展示字段由入口 query 带入）：歌曲头 + 相似歌曲 + 热评/最新评论 + 加载更多；入口在**全屏播放器顶栏「歌曲详情」** | 详情页可播放 / 看评论 / 跳转专辑 | 平台层（+4）+ e2e（4a-20）+ UI demo（+3）+ 真机 |

> **P3 收尾（2026-09-24）**：P3 批一（P3.1 搜索 / P3.2 热搜·联想·历史 / P3.3 排行榜 / P3.4 歌单广场）与批二（P3.5 每日推荐 / P3.6 私人 FM / P3.7 歌手页 / P3.8 专辑页 / P3.9 歌曲详情）**全部完成**。
> 期间共发现并处理 4 处「上游接口失效」：musicu 搜索返回空表、歌单详情 `fcg_ucc_getcdinfo_byids_cp` 返回空 `cdlist`（连带修复粘贴歌单/点歌单）、排行榜老接口 404/空、热搜与电台老接口被 WAF 拦（均改用 musicu 模块或雷达）。
> 全部工作项均带 fixture 单测（平台层）+ 传输层 e2e + 离线 UI 用例 + 真机验证记录（见第 5/8/9 节）；新增页面：`/search`、`/rank`、`/square`、`/daily`、`/fm`、`/artist/:mid`、`/album/:mid`、`/song/:id`。

### P4 个人库写操作

> **P4.0 写操作基础设施**：`buildComm` 注入 `g_tk`（由 `qm_keyst` 计算）、写操作错误码与 toast 映射、二次确认组件、写后状态回填与缓存失效。
> 硬依赖：`qm_keyst`（受限会话无法写）；接口需在模拟器 QQ 音乐抓包验证后实施。
> **✅ 2026-09-24 写通道结论（已解决）**：`musicu.fcg` 的新增类写操作被上游一律拒绝（业务码 80105，与歌曲无关、信封变体无效；dirId/参数校验正常 80092/1101）。
> 改用**签名网关** `u.y.qq.com/cgi-bin/musics.fcg?_=<ms>&sign=<zzc签名>`（`src/core/zzcSign.js`：SHA1 → 索引抽取 + 异或 + base64 去符号）后**写入成功**：
> 真机实测 `AddSonglist` 返回 `code 0`（`dirId:201`「我喜欢」）、读回生效、删除复原。写路径已切到签名通道（`writeCall`）。
> **P4 写能力实测矩阵（2026-09-24/25 真机）**：✅ D1 红心 / **D2 收藏专辑** / **D3 收藏歌单** / D4 创建歌单 / D6 删除 / D7 加歌·删歌；
> D2/D3 的**正确方法名**由活跃维护的 `L-1124/QQMusicApi` 源码获得并真机验证：
> `AlbumFavWrite/FavAlbum|CancelFavAlbum` `{v_albumId:[数字id]}`（注意不是 AddAlbumFav）、
> `PlaylistFavWrite/FavPlaylist|CancelFavPlaylist` `{uin:加密uin, v_playlistId:[disstid]}`（注意不是 AddPlaylistFav）；
> 之前探测的 `AddAlbumFav`/`AddPlaylistFav` 均 40000 属于方法名错误。
> ⏸ 仍缺（2026-09-25 spike 收尾结论）：
> · **D5 改名**：`ModifyPlaylist` 40000 / `EditPlaylist` 1101，参数未破解；L-1124 未实现改名。
> · **D9 关注歌手**：旧 Web 接口已废（`fcg_order_singer_getlist` 500、`fcg_order_singer_add/del` 100003）；`music.concern.RelationList` **读**可用（`GetFollowSingerList` code 0），但 7 种写方法候选均 40000——且**假方法同样 40000**（该通道对「方法不存在/参数错」不区分），无法判定；需真机抓包（QQ 音乐 App）才能确定。
> · **D8 云历史**：9+5 种模块名候选均 500003，模块名未知。
> · 抓包路线受阻：QQ 音乐手机版 arm64-only（MuMu 报 `INSTALL_FAILED_NO_MATCHING_ABIS`）、车机版启动 SIGSEGV、MuMu ARM bridge 未启用执行；后续可尝试「MuMu 应用中心装 + 开 ARM 兼容」或换支持 ARM 翻译的模拟器（雷电 9）。

| 编号 | 工作项 | 接口（`[已验证]` / `[待抓包验证]`） | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P4.0 | 写操作基础设施 | `src/api/qq/write.js`（`canWrite` / `writeCall` **走签名网关** / `writeError` 处理 网关code·业务code·`retCode` 三处，码表 1000/1001/80105）+ `src/core/zzcSign.js`（musics.fcg 的 zzc 签名，Web Crypto 平台无关）+ `src/store/write.js`（`ensureWritable` 票据守卫 + 统一错误 toast）+ `ConfirmDialog.vue` 与 `askConfirm()`（历史清空已接入）+ `invalidateLibrary(kind)` 统一失效 + `mapSong` 补 `songType` | 写操作可发出并正确报错（缺票据不发请求）；签名通道写入生效 | 平台层第 24 节（8 项）+ e2e 4a-21（4 项） |
| ✅ P4.1 | D1 喜欢 / 取消喜欢 | `src/api/qq/fav.js`（`SongFavRead/IsSongFanByMid` 批量回显 + `PlaylistDetailWrite/AddSonglist\|DelSonglist` dirId=201，参数 `bFmtUtf8`+数字 `songId`/`songType`）+ `src/store/fav.js`（状态缓存 + `toggleFav` 乐观更新/失败回滚/成功后失效 liked）+ UI 红心（SongRow / PlayerBar / NowPlaying，列表进入自动回显） | 红心状态回显正确；**真机写验证通过**（加入 → 服务端读回 true → 移除 → 读回 false，账号复原） | 平台层第 25 节（5 项）+ e2e 4a-22（5 项）+ UI demo（+3）+ 真机 |
| ✅ P4.2 | D2 收藏 / 取消专辑 | `music.musicasset.AlbumFavWrite/FavAlbum\|CancelFavAlbum` `{ v_albumId: [数字 albumId] }`（源码 + 真机验证）；`src/api/qq/fav.js` + `src/store/favWrite.js`（乐观更新/回滚 + `invalidateLibrary('albums')`）；入口：专辑页「收藏专辑 / 已收藏」 | 收藏状态回显、收藏列表同步（真机读回验证） | 平台层（+4）+ e2e 4a-24（6 项）+ UI demo（+2）+ 真机（接口层） |
| ✅ P4.3 | D3 收藏 / 取消歌单 | `music.musicasset.PlaylistFavWrite/FavPlaylist\|CancelFavPlaylist` `{ uin: 加密uin, v_playlistId: [disstid] }`（源码 + 真机验证）；**读取：`PlaylistFavRead/CgiGetPlaylistFavInfo`（`v_list`）优先 + 旧接口兜底**（2026-09-25 UI 复验修正）；`ensureEuin()` 取加密 uin；入口：歌单页「收藏歌单 / 取消收藏」（非自建歌单） | 收藏状态回显、收藏列表同步（UI 端到端真机复验通过） | 平台层（+7）+ e2e 4a-24/4a-32（+9）+ UI demo（+2）+ 真机（UI 端到端） |
| ✅ P4.4 | D4 创建歌单 | `PlaylistBaseWrite/AddPlaylist` `{ dirName, dirDesc, dirPicUrl, taglist }` → `result { dirId, tid }`（真机实测）；`src/api/qq/playlistWrite.js` + `src/store/playlistWrite.js`（输入弹窗 + 乐观入侧栏 + `invalidateLibrary('playlists')`） | 新歌单出现在侧栏（真机通过） | 平台层（+5）+ e2e 4a-23（5 项）+ UI demo（+3）+ 真机 |
| ⏸ P4.5 | D5 编辑歌单 | `ModifyPlaylist`（40000）/ `EditPlaylist`（1101）参数结构未破解；L-1124 未实现改名 | 待抓包补齐后实施 | 探测矩阵已记录 |
| ✅ P4.6 | D6 删除歌单 | `PlaylistBaseWrite/DelPlaylist` `{ dirId }`（真机实测）；入口：侧栏 hover 垃圾桶 + 歌单页头部（空歌单也可用，已修模板分支）；二次确认用通用 `ConfirmDialog` | 删除后侧栏消失（真机通过） | 同上 |
| ✅ P4.7 | D7 加歌 / 删歌 / 排序 | `PlaylistDetailWrite/AddSonglist\|DelSonglist`（`existed` 去重；**≤50 首/批 + 500ms 间隔**）；入口：歌曲行「加入歌单」（选择器 `AddToPlaylistDialog`）、歌单页头部「加入歌单」批量、歌曲行「从歌单移除」；**排序未做**（上游接口未验证） | 批量加歌结果正确（真机通过） | 同上 |
| ⏸ P4.8 | D8 云端最近播放 | 候选模块（PlayHistoryRead/SongHistory/RecentPlay 等 9 种）均 500003，模块名未破解 | 待抓包后实施 | 探测矩阵已记录 |
| ⏸ P4.9 | D9 关注 / 取消歌手 | `web_singer_info_svr` 各方法 500005、`SingerFavWrite` 系 500003，模块/参数未破解 | 待抓包后实施 | 探测矩阵已记录 |

### P5 评论与社交

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| P5.1 | E1 评论列表 | musicu `music.globalComment.CommentRead` `[待抓包验证]`；热评 / 最新、分页、点赞数、子评论 | 评论列表正确加载 | e2e（fixture） |
| P5.2 | E2 写评论 | `CommentWrite` 系 `[待抓包验证]`：发 / 回复 / 点赞 / 删除 | 操作成功并即时更新 | mock + 手动 |
| P5.3 | E3 分享 | 分享链接 / 二维码（canvas 生成）；App 走 Capacitor Share，Web 走 Web Share API / 复制 | 分享内容正确 | e2e |
| P5.4 | E4 一起听 spike | 抓包确认 QQ「一起听」协议（长连接 / 房间）；结论：可做 / 自建替代 / 放弃 | 产出调研结论 | — |
| P5.5 | E5 好友动态 spike | 抓包确认社交动态接口与权限；结论：可做 / 放弃 | 产出调研结论 | — |

### P6 下载与离线

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P6.1 | F1 单曲下载 | `src/core/downloads.js`（能力桥）+ `src/platform/native/media.js`（`Directory.Data/bmp-downloads` **持久目录**、`downloadAudio` 带进度事件）+ `src/store/downloads.js`（`resolveDownloadUrl`：按音源偏好解析 QQ 直链/B站音频流，失败回退另一侧）+ 入口：歌曲行与播放器底栏（状态：下载/进度/已下载）+ `bmp:downloads` 索引 | 下载文件可离线播放（真机 2.6MB 稻香 · QQ音源） | 平台层第 28 节（+5）+ e2e 4a-25（+7）+ UI demo（+2）+ 真机 |
| ✅ P6.2 | F2 批量下载 | 歌单页「下载全部」→ `queueDownloads`（**并发 2**、失败清单、`retryFailedDownloads` 重跑失败项；不做断点续传） | 批量任务可重跑失败项 | e2e 4a-25（队列断言）+ 真机 |
| ✅ P6.3 | F3 离线播放 | `player.js` `startPlayback` 优先命中 `state.downloads[key]`（`source='local'`，seek 可用）+ `song.localUri`（本地导入）+ 播放器「本地播放」徽标 | 飞行模式可播已下载歌曲（**2026-09-25 飞行模式实测通过**：离线冷启动 → 稻香 本地播放 + 进度推进 + 拖动 65%；无匹配歌曲离线时优雅降级为内嵌播放并提示） | 真机 |
| ✅ P6.4 | F4 本地音乐导入 | `/storage` 页 `<input type=file>` → base64 → `Directory.Data/bmp-local-music` → 文件名解析「歌手 - 歌名」→ `bmp:local-music` → 可直接播放 | 本地歌曲可导入播放（真机管线验证） | 平台层（文件名解析）+ 真机 |
| ✅ P6.5 | F5 缓存管理页 | `/storage`（下载与存储）：下载/本地音乐/音频缓存（`dirSize` 递归统计，真机 **496.9MB**）/图片缓存 占用与分类清理；下载队列状态与重试 | 清理后占用下降 | UI demo（Web 提示）+ 真机 |

### P7 账号与数据

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P7.1 | G2 付费受限识别 | `song.js` 拆分 `fetchSongUrlInfo`（`parseSongUrlInfo` 纯函数：`purl` → 直链；空+`result=104003` → `vip_required`；空 → `copyright_unavailable`；其它码 → `url_unavailable`）+ `mapSong`/搜索结果带出 `payplay`/`hasPreview` + 歌曲行与搜索行 `data-vip` 金色 VIP 标注（CSS `::after`，不污染 textContent）+ 播放回退原因细化（「QQ 需要会员 / VIP 歌曲无直链，已回退 B 站音源」）+ 下载错误提示带受限原因 | 受限歌曲不静默失败 | 平台层第 29 节（+5）+ e2e 4a-26（+3）+ UI demo（+1） |
| ✅ P7.2 | G3 多账号切换 | `store/accounts.js`（`bmp:accounts` 最多 5 个：保存当前登录快照 / 去重 / 切换 / 删除）+ 切换复用 `loginWithCookie`（清残留 → 重载歌单 → 体检）+ 设置页「账号切换」区（列表 / 切换 / 删除 / 保存当前账号） | 切换后数据正确 | e2e 4a-29（+8）+ UI demo（+2）+ 真机 |
| ✅ P7.3 | G4 听歌报告 | `src/api/stats.js`（纯函数：`recordListen` 上限 5000 / `addListenMs` 只增不减 / `statsSummary` 汇总 / `formatListenDuration`）+ `store/stats.js`（播放开始记事件、timeupdate 累积时长、4s 延迟落盘 + 切歌/暂停 flush；`bmp:listen-stats`）+ 播放钩子（`playAudioSource` / iframe / `pause` / `releaseAudio`）+ `/report` 页（近 7 天/30 天/全部、4 汇总卡、歌曲/歌手 Top10、24 小时分布、每日趋势、二次确认清空）+ 侧栏入口 | 统计口径正确 | 平台层第 30 节（+10）+ e2e 4a-27（+4）+ UI demo（+4）+ 真机 |
| ✅ P7.4 | G5 导入导出 | `src/api/transfer.js`（纯函数：JSON/m3u 导出、m3u/JSON 解析、`detectFormat`、文件名安全化、`bmp://local` 本地条目）+ `src/core/files.js`（保存能力桥：App 写 `Directory.External/bmp-exports`，Web Blob 下载）+ `src/api/qq/song.js` `fetchTracksByMids`（track info 批量补数字 songId，写歌单必需）+ `store/transfer.js`（导出当前歌单；导入 = 解析 → 补全（track info/搜索）→ 二次确认 → `AddPlaylist` + `AddSonglist`）+ UI（歌单页导出菜单、侧栏导入按钮 + 导入进度横幅） | 导出文件可再导入 | 平台层第 31 节（+8）+ e2e 4a-28（+6）+ UI demo（+3）+ 真机 |

### P8 外观与平台

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ✅ P8.1 | H1 深色主题 | CSS 变量双套（`:root` 暗色默认 + `[data-theme='light']` 亮色）+ `store/theme.js`（`resolveTheme` 纯函数 / `setTheme` 持久化 `bmp:config.theme` / system 跟随 `prefers-color-scheme` 监听）+ 设置页「主题」选择（跟随系统 / 亮色 / 暗色，切换立即生效）+ 补齐 `--card/--line/--hover/--accent` 别名（修复 P6/P7 新组件里未定义变量导致的边框/卡片样式缺失） | 两端主题正确 | 平台层第 32 节（+3）+ e2e 4a-30（+4）+ UI demo（+4）+ 真机 |
| ✅ P8.2 | H2 迷你播放器 | 复用桌面歌词悬浮窗框架：`MediaControlService` 新增迷你卡（歌名/歌手 + 上一首/播放暂停/下一首/关闭，可拖动记忆位置，与桌面歌词互斥、App 可见时自动隐藏）+ 插件 `setMiniPlayer/updateMiniPlayer` + `core/mediaControl.js` 能力桥 + `store/miniPlayer.js`（开关持久化 `bmp:mini-player`、权限引导、歌曲/播放态同步、按钮事件回 JS）+ 播放器底栏入口（仅 App） | 小窗可靠可控 | e2e 4a-31 + 源码断言（+3）+ UI demo（+1）+ 真机 |
| ✅ P8.3 | H3 桌面小组件 | `MiniWidgetProvider`（AppWidget：歌名/歌手 + 播放暂停/下一首，点卡片开 App；按钮复用通知栏同一条服务 action 链路）+ `widget_mini.xml` 布局 + `bmp_widget_info.xml`（4x1）+ 圆角背景 + 清单注册；`MediaControlService.updateNotification` 同步推送（并把快照写 `bmp-overlay` 供 onUpdate 恢复） | 小组件可用 | e2e 源码断言（+1）+ 真机（provider 注册 + 快照推送；添加到桌面为用户手动步骤） |
| ✅ P8.4 | B1b 逐字歌词 / 罗马音 | `musicu PlayLyricInfo` 一次请求 `qrc:1/roma:1/trans:1`（响应为 3DES+zlib 加密的 QRC/XML）→ `src/utils/qqc3des.js`（QQ 变体 3DES，MIT 参考实现移植；`DecompressionStream` 宽容解压 8 字节填充）+ `src/utils/qrc.js`（`extractQrcText` XML 实体 / `parseQrc` 行+词绝对时间 / `mergeQrcExtra` 翻译（LRC）与罗马音（QRC）/ `wordState` 词进度）+ `fetchLyric` 解密并回退明文 LRC + 缓存 v3（`bmp:lyric3:`）+ NowPlaying 逐字渲染（已唱词实色、当前词按 `--wp` 渐变）与罗马音行 + 「逐字 / 罗马音」开关（`bmp:config.lyricQrc` 默认开、`lyricRoma` 默认关）+ 配置默认值合并（老用户可拿到新默认值） | 逐字随播放推进、罗马音可显示 | 平台层第 34 节（+15，含真实加密 payload fixture）+ e2e 4a-33（+6）+ UI demo（+4）+ 真机 |

### P9 听歌识曲

| 编号 | 工作项 | 目标 / 接口 / 文件 | 验收 | 测试 |
|---|---|---|---|---|
| ⛔ P9.1 | C11 识曲 | **spike 结论：不做实现**（2026-09-25）。① QQ 识曲 = ACRCloud B2B（无公开接口，客户端内嵌商业凭证）；② Shazam 非官方端点需移植专有指纹算法（C/Rust 数千行）且实测 `amp.shazam.com` v5 tag 已 404（不稳定）；③ ACRCloud 自建（14 天试用后付费）架构可行但引入付费外部依赖；④ 原生录音本身可行（RECORD_AUDIO + AudioRecord 16k mono PCM），但无可用识别后端 → 本阶段放弃并记录 | 放弃（已记录） | spike（已记录） |

## 4. 高风险与调研项

| 项 | 风险 | 应对 |
|---|---|---|
| E4 一起听 | 私有实时协议，逆向成本极高 | P5.4 spike；备选：自建 WebSocket 同步（仅本应用用户间） |
| E5 好友动态 | 接口 / 权限不明 | P5.5 spike；不可行则放弃并记录 |
| C11 识曲 | 接口不明 + 需录音权限 | P9.1 spike：**结论不做**（QQ 识曲=ACRCloud 商业授权；Shazam 非官方算法移植成本高 + 端点实测 404；ACRCloud 需付费）；原生录音本身可行 |
| 写操作接口 | 受限会话无 `qm_keyst` 无法写 | 登录态检查 + 明确提示（引导网页登录 / 手动 Cookie） |
| 接口随版本变动 | QQ 侧随时调整 | 每项记录验证日期；封装集中在 `src/api/qq/*`，便于单点修复 |
| 原生 5 项 | 工作量大、需真机 | 独立阶段；Web 隐藏入口；每项手动验收清单 |
| 自动化测试盲区 | 写操作 / 真机功能无法自动测 | mock 单测 + 手动验收清单（每个 P4 项必附） |

## 5. 接口验证记录

> 格式：`日期 | 工作项 | module / method 或 URL | 结论 | 备注`

| 日期 | 工作项 | 接口 | 结论 |
|---|---|---|---|
| 2026-09-24 | C1 | `music.search.SearchCgiService/DoSearchForQQMusicDesktop` | **已失效**：2026-09 实测全类型 `code:0` 但列表全空（带登录态亦然），弃用 |
| 2026-09-24 | C1 | `c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?t=0/8` | **已实机验证**：单曲/专辑可用（返回 `data.song/album.list`，`curnum/curpage/totalnum` 可翻页） |
| 2026-09-24 | C1 | `c.y.qq.com/soso/fcgi-bin/client_music_search_songlist` | **已实机验证**：歌单可用（**JSONP** 需剥壳；`page_no` 0 基，`display_num` 为总数） |
| 2026-09-24 | C1 | `c.y.qq.com/soso/fcgi-bin/client_search_cp`（歌手 t=9） | **不可用**：WAF 拦截返回 500（空体）；歌手改为单曲结果聚合 |
| 2026-09-24 | C7 | `music.web_singer_info_svr/get_singer_detail_info` + `musichall.song_list_server/GetSingerSongList` + `music.musichallAlbum.AlbumListServer/GetAlbumList` + `music.SimilarSingerSvr/GetSimilarSingerList` | **已实机验证**：详情（`singer_info`/`singer_brief`/`total_song|album|mv`）+ 热门 + 单曲/专辑分页 + 相似歌手全部可用 |
| 2026-09-24 | C8 | `music.musichallAlbum.AlbumInfoServer/GetAlbumDetail` | **已实机验证**：`basicInfo`（含 `tranName/publishDate/desc/genre/language`）+ `company.name`；参数名是 `albumMId`（注意大小写） |
| 2026-09-24 | C8 | `c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg` | **仍可用**（实测 200 + 12 首歌曲）：专辑页歌曲列表继续沿用 |
| 2026-09-24 | C12 | `music.recommend.TrackRelationServer/GetSimilarSongs` | **已实机验证**：参数为**数字 songid**，`data.vecSong[].track` 嵌套一层；匿名可用 |
| 2026-09-24 | C12/E1 | `c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg` | **已实机验证**：`cid=205360772&biztype=1&topid=<数字id>&cmd=8`；热评 + 最新 + `commenttotal`；`pagenum` 0 基分页 |
| 2026-09-24 | D1（写通道 spike） | `musicu.fcg` `PlaylistDetailWrite/AddSonglist`（dirId=201） | **被上游拦截**：`code=80105` 且读回未生效（内层 `retCode:0` 是假象）；与歌曲无关、信封变体（`g_tk_new_20200303` / `ct:19`+`authst` / `songType:0`）均同码；dirId/参数校验正常（`80092`/`1101`） | 2026-09-24 真机 |
| 2026-09-24 | D1（**签名通道，已解决**） | `u.y.qq.com/cgi-bin/musics.fcg?_=<ms>&sign=<zzc签名>`（`music.musicasset.PlaylistDetailWrite/AddSonglist\|DelSonglist`） | **已实机验证写入生效**：`AddSonglist` → `code 0`（`dirId:201`「我喜欢」、`tid` 为 dissid）→ `IsSongFanByMid` 读回 `true`；`DelSonglist` → 0 → 读回 `false`（复原）。签名算法：SHA1(请求体) → 索引抽取 + 异或 + base64 去符号（`src/core/zzcSign.js`）；无签名→网关 2000、垃圾签名→被拒 | 2026-09-24 真机 |
| 2026-09-24 | D1（读接口） | musicu `music.musicasset.SongFavRead/IsSongFanByMid` | **已实机验证**：批量回显 `data.m_fan[mid]=true/false` 正常 |
| 2026-09-24 | D1（删） | `PlaylistDetailWrite/DelSonglist` | **返回 code=0**（不存在的歌也是 0；新增被拦但删除通道正常应答） |
| 2026-09-24 | D1/D7 | `music.musicasset.PlaylistDetailWrite/AddSonglist\|DelSonglist` | 参数形状已实测（`bFmtUtf8:true` + 数字 `songId`/`songType`）；新增受 80105 限制，见上 |
| 2026-09-24 | D4/D6/D7（签名通道） | `PlaylistBaseWrite/AddPlaylist\|DelPlaylist`、`PlaylistDetailWrite/AddSonglist\|DelSonglist` | **已实机验证全链路**：创建（`result.dirId/tid`）→ 加歌（读回 1 首）→ 删歌（读回 0 首）→ 删除（列表复原）；批量 51 首 → 2 批（50+1）；`existed` 去重字段可用 |
| 2026-09-24 | D2 | `music.musicasset.AlbumFavWrite/AddAlbumFav` | 方法名错误（`AddAlbumFav` 全形态 40000）；**正确方法为 `FavAlbum`**，见下 |
| 2026-09-25 | D2（已解决） | `music.musicasset.AlbumFavWrite/FavAlbum\|CancelFavAlbum` `{ v_albumId: [数字 albumId] }` | **已实机验证**：`FavAlbum` → `result:0`、无失败项 → `CgiGetAlbumFavInfo`（`{euin,offset,size}`）读回含该专辑（5→6 张）→ `CancelFavAlbum` → 读回 5 张（复原）。方法名与参数来自 `L-1124/QQMusicApi` 源码 |
| 2026-09-25 | D3（已解决） | `music.musicasset.PlaylistFavWrite/FavPlaylist\|CancelFavPlaylist` `{ uin: 加密uin, v_playlistId: [disstid] }` | **已实机验证**：`FavPlaylist` → `result:0` → `CgiGetPlaylistFavInfo`（`{uin:euin,offset,size}`）读回含该歌单 → `CancelFavPlaylist` → 读回 0（复原）。之前 `AddPlaylistFav` 40000 属方法名错误 |
| 2026-09-24 | D3 | `music.musicasset.PlaylistFavWrite/AddPlaylistFav` | 方法名错误（`AddPlaylistFav` 7 种组合均 40000）；**正确方法为 `FavPlaylist`**，见下 |
| 2026-09-25 | D2/D3（来源） | `L-1124/QQMusicApi`（活跃维护，2026-08）`modules/album.py`、`modules/user.py` | **方法名与参数来源**：`AlbumFavWrite/FavAlbum\|CancelFavAlbum` `{v_albumId:[id]}`；`PlaylistFavWrite/FavPlaylist\|CancelFavPlaylist` `{uin:euin, v_playlistId:[id]}`（该库未实现改名/云历史/关注歌手） |
| 2026-09-25 | D9（spike） | `c.y.qq.com/rsc/fcgi-bin/fcg_order_singer_getlist.fcg`（关注列表） | **已失效**：WAF 返回 500（空体） |
| 2026-09-25 | D9（spike） | `.../fcg_order_singer_add.fcg` / `..._del.fcg` | **不可用**：200 但 `code=100003`（系统忙/通道废弃）；旧 Web 关注方案（jsososo 2022）已死 |
| 2026-09-25 | D9（spike） | `music.concern.RelationList/GetFollowSingerList` | **可用**（`{HostUin: euin, From, Size}` → `List/Total/HasMore`）；写方法未知：7 候选均 40000 且**假方法同码**，无法判定 |
| 2026-09-25 | D8（spike） | 14 种模块名候选（PlayHistoryRead / SongHistory / RecentPlay / ListenHistory 等） | **模块名未知**：全部 500003 |
| 2026-09-24 | D5 | `PlaylistBaseWrite/ModifyPlaylist\|EditPlaylist` | **参数未破解**：ModifyPlaylist 全形态 `40000`；EditPlaylist 全形态 `1101`（方法存在但必填字段未知） |
| 2026-09-24 | D8/D9 | 云历史 / 关注歌手候选模块 | **模块未破解**：D8 9 种候选均 `500003`；D9 `web_singer_info_svr` 各方法 `500005`、`SingerFavWrite` 系 `500003` |
| 2026-09-24 | D4/D6 | `music.musicasset.PlaylistBaseWrite/AddPlaylist\|DelPlaylist` | 社区实现确认，待实机验证 |
| 2026-09-24 | P2.1 | `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` | 社区实现确认，待实机验证 |
| 2026-09-24 | C2 | `c.y.qq.com/splcloud/fcgi-bin/gethotkey.fcg` | **已失效**：WAF 拦截返回 500（同 `client_search_cp`），弃用 |
| 2026-09-24 | C2 | musicu `music.musicsearch.HotkeyService/GetHotkeyForQQMusicMobile` | **已实机验证**：热搜可用（`param: { search_id: '0' }`，`vec_hotkey` 30 条） |
| 2026-09-24 | C2 | `c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg` | **已实机验证**：输入联想可用（`data.song/singer/album/mv.itemlist`） |
| 2026-09-24 | C3 | `fcg_v8_toplist_index.fcg` / `fcg_v8_toplist_cp.fcg` | 社区实现确认，待实机验证 |
| 2026-09-24 | C3 | `fcg_v8_toplist_index.fcg` / `fcg_v8_toplist_cp.fcg` | **已失效**：index 404、detail 返回空 `data:{}`，弃用 |
| 2026-09-24 | C3 | musicu `musicToplist.ToplistInfoServer/GetAll` + `GetDetail` | **已实机验证**：4 组 30 榜；详情 `data.data.song[]` + `data.songInfoList[]` 按下标合并；`period` 空值需用返回周期重试 |
| 2026-09-24 | C4 | `fcg_get_diss_tag_conf.fcg` | **已实机验证**：6 组分类（热门/语种/流派/主题/心情/场景）+ 每组排序项（最新/最热/评分） |
| 2026-09-24 | C5 | `music.recommend.TrackRelationServer/GetRadarSong` | **已实机验证**：匿名可用，`Page` 翻页、每页 10 首、`HasMore`；`VecSongs[].Track` 与歌曲模型同构。参考：QQ 无「每日30首」直连接口 |
| 2026-09-24 | C5/C6 | `music.radioProxy.MbTrackRadioSvr/get_radio_track` | **不可用（作 FM 音源）**：匿名与登录态都只出 1~3 首/次、默认落在「睡前」助眠白噪音场景 → P3.6 改用雷达 `GetRadarSong` 实现 FM（连续补货 + 不重复） |
| 2026-09-24 | P3.4 | `fcg_get_diss_by_tag.fcg` | **已实机验证**：按分类取歌单可用（`sin`/`ein` 为闭区间；`sum` 总数；条目含 dissid/dissname/imgurl/listennum/creator） |
| 2026-09-24 | C4/P3.1 | `fcg_ucc_getcdinfo_byids_cp.fcg`（歌单详情） | **已失效**：返回 `code:0` 但 `cdlist` 为空 → 旧「粘贴歌单链接」实际已坏，改 musicu `music.srfDissInfo.DissInfo/CgiGetDiss`（真机 66 首歌单完整加载） |
| 2026-09-25 | C11/P9.1 | QQ 音乐「听歌识曲」 | **不可用（商业依赖）**：由 ACRCloud 提供（B2B 音频指纹服务），客户端内嵌商业凭证，无公开接口；自建需 ACRCloud 账号（14 天试用后付费） |
| 2026-09-25 | C11/P9.1 | `amp.shazam.com/discovery/v5/.../tag/...`（Shazam 非官方） | **不可用（实测 + 成本）**：POST 空签名返回 404（端点/风控已变）；且需移植专有指纹生成算法（SongRec/shazamio-core 为 C/Rust 数千行），非官方接口稳定性与条款风险高 |
| 2026-09-25 | C11/P9.1 | 原生录音可行性（RECORD_AUDIO + AudioRecord） | **技术上可行**（16k mono PCM 采集 + 权限引导，与现有自定义插件同套路），但无可用识别后端 → 无落地价值；P9 结论：不做实现（与 P5 同列 ⛔） |
| 2026-09-26 | P5 E2 | 签名网关 `music.globalComment.CommentWriteServer/AddComment`、`DelComment` | **已实测可用**：探测 DelComment 可达（非 500003）；真机 UI 发评论 → 刷新可见（带 uin → 可删除）→ 删除成功，账号无残留 |
| 2026-09-26 | P5 E2 | musicu `CommentRead/GetHotCommentList`、`CommentCountSrv/GetCmCount`（L-1124 参考） | 未迁移（现有旧 CGI 读取正常）；写侧已走签名网关 |
| 2026-09-26 | P5 E3 | 分享（复制链接 + `qrcode` canvas + `@capacitor/share@8.0.2`） | **已实测**：App 内二维码渲染、剪贴板内容与链接一致、系统分享面板弹出（ChooserActivity）；Web 隐藏系统分享 |
| 2026-09-26 | P5 E5 | `music.homepage.Friendship/GetFriendList` | **不可用**：`code 1001`、`Friends` 空（好友数据/鉴权不通过） |
| 2026-09-26 | P5 E5 | `music.concern.RelationList/GetFollowSingerList`（`{HostUin: euin, From, Size}`） | **可用（只读）**：真机 Total 19、`List[].MID/Name/AvatarUrl`；关注/取关写方法不存在（同 D9） |
| 2026-09-26 | P5 E4 | `music.room.RoomServer` / `music.listen.together.Service` / `music.together.RoomService`（GetRoomInfo） | **模块不存在**（均 500003）→ E4 收口：一起听为私有实时协议，不做 |
| 2026-09-26 | P9 / D8 / D9（复探） | 识曲 5 候选模块（`music.recognize.RecognizeServer` / `music.musicsearch.SongIdentify` / `music.identify.IdentifyServer` / `music.fingerprint.FingerprintServer` / `music.audio.AudioIdentifyServer`）；云历史 4 候选（`musicasset.PlayHistoryRead` / `music.history.PlayHistoryServer` / `music.recentplay.RecentPlayServer` / `music.listen.ListenHistoryRead`）；关注歌手写 4 候选（`concern.RelationWrite` / `concern.FollowWrite` / `concern.SingerFavWrite` / `musicasset.SingerFavWrite`） | **全部 500003**（模块不存在）：P9 无公开识别模块（维持不做）、D8/D9 写维持 ⏸ |
| 2026-09-26 | D5（复探） | 一次性测试歌单上试 `PlaylistBaseWrite/ModifyPlaylist`（`dirId,dirName` / `dirId,name` / `dirId,dirName,dirDesc,taglist` / `dirId,newName`）与 `EditPlaylist`（`dirId,dirName` / `dirId,name` / 全字段） | **负结论维持**：Modify 全 40000、Edit 全 1101，歌单名未变化；测试歌单已删除（服务端复核无残留） |
| 2026-09-26 | P5 E2 点赞（探测收口） | ① `CommentWriteServer` × 20+ 方法候选（LikeComment/PraiseComment/…）→ 500005；② 12 个点赞候选模块（CommentPraiseSrv/CommentActionServer/…）→ 500003；③ `music.globalComment.CommentWrite`（模块存在）+ `PraiseComment {CmId}` → code 0 但读回 `praisenum/ispraise` 不变（25s 排除缓存）；④ 旧 CGI cmd 变体未找到可验证路径（未做破坏性全矩阵） | **负结论**：评论点赞写通道未找到，维持未实现；读侧 `ispraise` 字段已确认存在（临时评论已全部删除） |

## 6. 进度追踪

### P0 基础设施
- [x] P0.1 路由骨架
- [x] P0.2 musicu 统一封装
- [x] P0.3 白名单与 Referer 修复
- [x] P0.4 api 拆分
- [x] P0.5 store 拆分
- [x] P0.6 测试脚手架

### P1 播放器核心
- [x] P1.1 A2 播放队列
- [x] P1.1b 移动端播放条队列入口
- [x] P1.1c 进度条 seek 稳定性
- [x] P1.2 A3 播放历史
- [x] P1.3 A6 睡眠定时
- [x] P1.4 A11 媒体控制（Web）
- [x] P1.4b A11 媒体控制（App 原生）

### P2 歌词
- [x] P2.1 B1 歌词获取与解析
- [x] P2.2 B3 全屏歌词页
- [x] P2.4 歌词同步修复（S1 校准 / S2 iframe 定位 / S3 帧级插值）
- [x] P2.5 全屏播放器默认歌词视图
- [x] P2.6 歌词翻译修复（musicu `trans:1`）
- [x] P2.3 B4 桌面歌词

### P3 搜索与发现
- [x] P3.1 C1 综合搜索（真机四类可用；歌手=单曲结果聚合）
- [x] P3.2 C2 热搜 / 联想 / 历史（热搜改 musicu HotkeyService、联想 smartbox、历史随 P3.1）
- [x] P3.3 C3 排行榜（改 musicu ToplistInfoServer：GetAll + GetDetail，含 period 重试）
- [x] P3.4 C4 歌单广场（含歌单详情接口修复：老 fcg_ucc → musicu CgiGetDiss）
- [x] P3.5 C5 每日推荐（雷达 GetRadarSong 凑 30 首；匿名可用）
- [x] P3.6 C6 私人 FM（电台接口不可用 → 雷达 + 自动补货 + 不喜欢/不重复）
- [x] P3.7 C7 歌手页（详情/热门/单曲/专辑/相似歌手，搜索歌手入口）
- [x] P3.8 C8 专辑页增强（musicu 元信息增强 + /album/:mid；收藏留待 P4.2）
- [x] P3.9 C12 歌曲详情页（相似歌曲 + 评论 + 播放器入口）

### P4 个人库写操作
- [x] P4.0 写操作基础设施（writeCall/writeError/ConfirmDialog/invalidateLibrary/songType）
- [x] P4.1 D1 喜欢/取消喜欢（回显 + UI + 乐观回滚；**真机 Add 被上游 80105 拦截**）
- [x] P4.4 D4 创建歌单（输入弹窗 + 乐观入侧栏；真机通过）
- [x] P4.2 D2 收藏 / 取消专辑（`FavAlbum`/`CancelFavAlbum` + `v_albumId`；真机通过）
- [x] P4.3 D3 收藏 / 取消歌单（`FavPlaylist`/`CancelFavPlaylist` + 加密 uin；真机通过）
- [ ] P4.5 D5 编辑歌单（参数未破解，⏸）
- [x] P4.6 D6 删除歌单（侧栏 + 歌单页入口，二次确认；真机通过）
- [x] P4.7 D7 加歌 / 删歌（批量 50/批 + 选择器；排序未做）
- [ ] P4.8 D8 云端最近播放（模块未破解，⏸）
- [ ] P4.9 D9 关注 / 取消歌手（模块未破解，⏸）

### P5 评论与社交
- [x] P5.1 E1 评论列表（只读，随歌曲详情 P3.9 落地）
- [x] P5.2 E2 发评论 / 回复 / 删除（签名网关；真机发→删复验；**点赞方法名未找到，未实现**）
- [x] P5.3 E3 分享（复制链接 + canvas 二维码；App 系统分享 `@capacitor/share`）
- [x] P5.4 E4 一起听 spike（候选模块均 500003 → 收口不做）
- [x] P5.5 E5 好友动态 spike（好友列表 1001 不可用；关注歌手只读落地）

### P6 下载与离线
- [x] P6.1 F1 单曲下载（持久目录 + 进度 + 索引；真机通过）
- [x] P6.2 F2 批量下载（并发 2 + 失败重跑；不做断点续传）
- [x] P6.3 F3 离线播放（本地优先 + 「本地播放」徽标）
- [x] P6.4 F4 本地音乐导入（文件选择器 + 文件名解析；未做 MediaStore 扫描）
- [x] P6.5 F5 缓存管理页 `/storage`（占用统计 + 分类清理）

### P7 账号与数据
- [x] P7.1 G2 付费受限识别（vkey 受限原因 + VIP 标注 + 回退提示）
- [x] P7.2 G3 多账号切换（bmp:accounts + 设置页；真机保存/持久化通过）
- [x] P7.3 G4 听歌报告（本地收听事件 + 统计页 + 真机）
- [x] P7.4 G5 导入导出（JSON / m3u；track info 补 songId；真机导出通过）

### P8 外观与平台
- [x] P8.1 H1 深色主题（亮/暗/跟随系统 + 持久化；真机通过）
- [x] P8.2 H2 迷你播放器（悬浮小窗：拖动/控制/互斥；真机通过）
- [x] P8.3 H3 桌面小组件（4x1 卡片；provider 注册与状态推送已验证；添加到桌面为手动步骤）
- [x] P8.4 B1b 逐字歌词 / 罗马音（QRC 3DES 解密 + 逐字渲染 + 罗马音行；真机通过）

### P9 听歌识曲
- [x] P9.1 C11 识曲 spike（结论：不做实现——QQ 识曲为 ACRCloud 商业授权、Shazam 非官方端点不可用；已记录）

## 7. 测试基线（必须保持全绿）

| 套件 | 命令 | 基线 |
|---|---|---|
| 平台层 | `npm run test:platform` | 329 / 0 FAIL |
| e2e | `npm run test:e2e` | 369 / 0 FAIL |
| UI 桌面 | `npm run test:ui` | 15 / 0 FAIL |
| UI 桌面+演示 | `npm run test:ui:demo` | 152 / 0 FAIL（可跳过用例较多，实测 148–152） |
| UI 移动 | `npm run test:ui:mobile` | 26 / 0 FAIL |
| UI 移动+演示 | `npm run test:ui:mobile:demo` | 170 / 0 FAIL（同上，实测 166–170） |

约定：独立端口 5199；只杀自己启动的 PID；demo 模式零外网。

## 8. 变更记录
| 日期 | 工作项 | 变更 | 验收 |
|---|---|---|---|
| 2026-09-24 | P0.1 | 引入 `vue-router@4.6.4`（hash 模式）；新增 `src/router/index.js`；`PlaylistView.vue` 移至 `src/views/`；`App.vue` 内容区改 `<RouterView>`；`main.js` 挂载路由 | 6 套基线全绿（115/163/11/41/16/51） |
| 2026-09-24 | P0.2 | 新增 `src/api/qq/comm.js`（buildComm / buildWriteComm / postMusicu / musicuCall / musicuError）；`qq.js` 三处 musicu 调用改走 `buildComm` | 平台层 115 / e2e 163 全绿 |
| 2026-09-24 | P0.3 | `upstreams.js` 新增 `REFERER_BY_HOST`/`refererForHost()`，QQ CDN 进 `MEDIA_HOST_ALLOW`；`native/media.js` 与 `server/image-proxy.js` 按域名选 Referer | 平台层 123 / e2e 163 / UI 11+41+16+51 全绿 |
| 2026-09-24 | P0.4 | `src/api/qq.js` 拆分为 `src/api/qq/*`（comm/util/user/song/playlist/album/index），原路径保留 barrel；e2e 守卫新增 `readQqApiSource()` 并纳入敏感信息扫描 | 平台层 123 / e2e 163 / UI 11+41 全绿 |
| 2026-09-24 | P0.5 | `src/store/index.js` 拆为 8 个域模块 + 聚合 barrel；e2e 守卫新增 `readStoreSource()`；hydrate 运行时测试改为对 `state.js` 缓存穿透 | 6 套全绿（123/164/11/41/16/51） |
| 2026-09-24 | P0.6 | 新增 `scripts/lib/mock-transport.mjs` + `scripts/fixtures/qq/*`；e2e「创建的歌单」用例改走 fixture，新增脚手架自检（含 fetchSongUrl / fetchLikedSongs fixture 集成） | 平台层 123 / e2e 169 / build 通过 |
| 2026-09-24 | P1.1 | 播放队列显式化（`state.queue` + `player.queueIndex`）；新增队列 API 与 `bmp:queue` 持久化；新增 `QueuePanel.vue`（指针拖动排序）与 PlayerBar / NowPlaying / SongRow 入口 | 6 套全绿（123/186/11/48/16/58） |
| 2026-09-24 | P1.2 | 最近播放纯本地化：`bmp:history`（上限 200，播放即记录、去重上移）；`playLocalQueue` 本地队列播放；`HistoryView.vue` + `/history` 路由 + 侧栏入口；侧栏选歌单自动回 `/` | 6 套全绿（123/192/11/54/16/64） |
| 2026-09-24 | P1.3 | 睡眠定时：`setSleepTimer` / `cancelSleepTimer`（到点自动暂停、不持久化）；`SleepTimerButton.vue` + PlayerBar / NowPlaying 入口与倒计时角标 | 6 套全绿（123/196/11/58/16/68） |
| 2026-09-24 | P1.4 | Web 媒体控制：`src/store/mediaSession.js`（Media Session 元数据 / 动作 / 播放状态 / 进度），特性检测；UI demo 实测 headless Chrome 元数据正确 | 6 套全绿（123/198/11/60/16/70） |
| 2026-09-24 | 设备验证 | 模拟器（emulator-5554）安装新包实测 P0/P1：路由 hash / 队列（647→500 上限持久化）/ 最近播放（真实播放入历史、跨重启保留）/ 睡眠定时 / 媒体控制安全跳过；发现并修复「重启恢复队列后点迷你条打不开全屏播放器」（`expandPlayer` 同时认 `queueIndex`）；新增 `scripts/android-cdp.mjs` | 修复后 6 套全绿（123/199/11/61/16/71）+ 真机复验通过 |
| 2026-09-24 | P2.1 | 歌词接口 + LRC 解析（`[offset:]` / 多时间戳 / 翻译 50ms 容差）+ 自动跟随当前曲 + `bmp:lyric:<mid>` 缓存（配额满自愈）；`src/utils/lrc.js` 平台层 14 项单测 | 平台层 138 / e2e 207 全绿 |
| 2026-09-24 | P2.2 | 全屏歌词页（封面 ↔ 歌词、滑动/按钮切换、当前行高亮 + 自动居中、点击 seek、翻译、重试）；demo 注入歌词缓存离线验证 | UI 11/65/16/75 全绿 |
| 2026-09-24 | 设备验证（P2） | 模拟器实测歌词：**发现 App 端歌词 404** —— `main.js` 静态导入 App 导致 store 模块级请求在 `initPlatform()` 之前发出、绕过原生拦截器；修复为动态导入 App/router（`platform-test` 新增守卫）；修复后真机歌词 59 行加载 + 缓存 + 点击定位正常 | 6 套全绿（138/207/11/65/16/75）+ 真机复验通过 |
| 2026-09-24 | P2.4 | 歌词同步三修：S1 校准（±0.5s/重置，按歌曲持久化）、S2 iframe `t=` 定位（真机实测 `t=90` → `video.currentTime=91.2`）、S3 rAF 插值；**另修复真机发现的重启后播放键禁用**（`state.songs` 为空但队列有歌）；`elapsed` 接入 smoothTime | 6 套全绿（145/218/11/69/16/79）+ 真机复验通过 |
| 2026-09-24 | P2.5 + P2.6 | 默认歌词视图 + 记住选择（`bmp:lyric-view`）；歌词改走 musicu `PlayLyricInfo` + `trans:1`（真机实测翻译 25 行），老接口回退；缓存升级 `bmp:lyric2:` + 旧键清理；过滤 `//` 占位 | 6 套全绿（148/220/11/72/16/82）+ 真机复验通过 |
| 2026-09-24 | P1.4b + P2.3 | 原生媒体控制（MediaSession + 前台服务 + MediaStyle 通知 + 蓝牙按键）+ 桌面歌词悬浮窗（可拖动 / 位置持久化 / 重启恢复）；**修复两个布尔持久化 bug**（`bmp:lyric-view`、`bmp:desktop-lyric` 存 `1/0` 被 `JSON.parse` 成数字导致重启失效） | 6 套全绿（154/228/11/73/16/83）+ 真机复验通过 |
| 2026-09-24 | P2.3b + P2.4b | 悬浮窗改版（完整控制卡片 + 前台隐藏 + 关闭同步 + 通知进度/歌词开关）；歌词页校准条紧凑化（不换行 + 图标按钮）；长按连续调整 + 节流落盘 + 时长差异提示；校准配置独立持久化（旧歌保留 -0.5s，新歌 +2.5s 并存） | 6 套全绿（157/233/11/76/16/86）+ 真机复验（前台隐藏/长按/不换行/进度推进） |
| 2026-09-24 | 真机验证（P2.3b） | 手机（Android 真机）实测：前台隐藏 → HOME 后卡片出现（958px 宽 @61,408）；点卡片按钮 `dispatch next/pause/prev` 全部生效（**后台切歌成功**，FGS 保活有效）；关闭按钮 → `overlay hidden` + JS 开关同步 `false`；通知 `actions=4`（含「桌面歌词」） | 通过；修复真机发现的「拖拽监听拦截按钮点击」（e2e +1 守卫） |
| 2026-09-24 | 真机验证（P2.3b 第二版） | 手机实测：App 内开关两态文字（已开启/未开启 + 绿色填充/灰色描边）；通知栏动作图标两态（空心窗口 ↔ 实心窗口，截图对比）；移动端播放条队列入口可见可点；歌词页两行布局 | 通过；两态图标差异明显 |
| 2026-09-24 | P1.1c + 通知图标 | seek 稳定性（基准取目标 / 忽略窗口 / 重试 / 拖动仅预览）+ 通知动作换自绘矢量（去 Flyme 系统位图黑边） | 6 套全绿（164/240/11/77/16/87）+ 真机：点 70% 落 70.06% 无回弹、图标无黑边 |
| 2026-09-24 | 通知栏 seek 回弹修复 | 根因：原生状态推送 5s 节流 → seek 后系统面板按旧 PlaybackState 把进度条拉回；`player.seekSeq` + 原生分支立即/250ms 尾随推送；顺带加固 e2e（WBI 上游抖动不再崩溃脚本） | 6 套全绿（164/241/11/77/16/89）+ 真机：seek 后 session 位置即时 142s、通知栏进度跟随真实播放 |
| 2026-09-24 | 大跨度 seek 回弹修复 | 30s+ 跳转缓冲更久，原「2s 窗口 + 一次重试」会在缓冲完成前放弃并接受旧位置（两次回弹）；改为**缓冲期间保持目标**（`audioEl.seeking` + 20s 硬上限，`seeked` 到达即收尾）+ 原生 `onSeekTo` **同毫秒乐观更新会话/通知** | 6 套全绿（165/241/11/77/16/89）+ 真机：141s 跳转无回落、通知栏点击路径稳定 |
| 2026-09-24 | P3.1 | 综合搜索：`/search` 路由 + 侧栏/顶栏入口 + 四类 Tab + 分页「加载更多」+ 点歌/跳专辑跳歌单 + 搜索历史（`bmp:search-history` 去重上移上限 20）；**接口迁移**（musicu 搜索已空表）：单曲 `search_for_qq_cp t=0`、专辑 `t=8`、歌单 `client_music_search_songlist`（JSONP 剥壳、HTML 实体解码）、歌手=单曲聚合（保留 `singer[]` mid，T001 头像，无 mid 不伪造）；测试新增 CDP Fetch 全链路 mock（`*qq-api*` GET 路由） | 6 套全绿（176/251/11/84/16/96） |
| 2026-09-24 | 真机验证（P3.1） | 手机（Android 真机）真实网络实测四类搜索：单曲「稻香」20 条/总数 600、专辑「叶惠美」20 条/总数 48、歌单「华语」20 条/总数 951976（`华语\| 修复心情` 实体解码正确）、歌手「周杰伦」聚合 1 条（20 首相关单曲）；**点搜索结果播放 → B站匹配成功**（`稻香 · B站音源`，`playing=true`）；另修复两处测试脆性（搜索按钮禁用竞态 + 404/上游抖动噪声归类） | 通过 |
| 2026-09-24 | P3.2 | 热搜与联想：`gethotkey.fcg` 已 500 → 改 musicu `HotkeyService/GetHotkeyForQQMusicMobile`（`parseHotKeys` 去重限量）；联想 `smartbox_new.fcg`（`parseSuggestions` 单曲→歌手→专辑→MV）；`SearchView.vue` 热搜榜区块 + 输入联想下拉（250ms 防抖 / 按词缓存 / ↑↓/Enter/Esc）；测试新增 fixture `hotkey.json`/`suggest.json`、CDP mock 两条路由；顺带加固歌词用例（等 ≥3 行 + 轮询定位结果） | 6 套全绿（181/256/11/86/16/98） |
| 2026-09-24 | 真机验证（P3.2） | 手机（Android 真机）真实网络实测：热搜榜 12 条渲染（前三高亮）、点第一条「易烊千玺dvd」→ 20 条结果且回填输入框；输入「周杰」→ 8 条联想（单曲/歌手/专辑分组），点单曲「晴天」→ 结果加载、下拉关闭；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P3.3 | 排行榜：老接口 index 404 / detail 空 → 改 musicu `musicToplist.ToplistInfoServer`（`GetAll` 分组 + `GetDetail` 合并 `song[]`×`songInfoList[]`，`period` 空值自动重试）；`src/api/qq/rank.js`（纯函数解析）+ `src/views/RankView.vue`（4 组 Tab / 榜单卡片 / 排名列表 / 播放全部 / 加载更多，裸数字涨幅不展示）+ `/rank` 路由与侧栏入口；测试新增 `rank-index.json`/`rank-detail.json`、CDP mock 榜单路由；顺带修歌词定位用例的换源竞态（等播放推进，否则 SKIP） | 6 套全绿（187/260/11/90/16/101） |
| 2026-09-24 | 真机验证（P3.3） | 手机（Android 真机）真实网络实测：4 分组与 30 榜卡片、默认热歌榜（共 300 首、前三名茶汤/我不难过/甲乙丙丁 与 QQ 端一致）、切「飙升榜」（首行涨幅 `15%`）、「播放全部」→ 茶汤 B站匹配成功并播放（`郁可唯 · B站音源`，playing=true）；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P3.4 | 歌单广场：`fcg_get_diss_tag_conf`（分类）+ `fcg_get_diss_by_tag`（闭区间 sin/ein）→ `src/api/qq/square.js`（parseTagGroups/parseSquareList，含 HTML 实体解码）+ `src/views/SquareView.vue`（分组 Tab → 分类/排序 chips → 卡片墙 → 加载更多 → 点卡片打开歌单，分组切换自动选中该组首个分类避免「标签墙」）；**修复歌单详情**：老接口 `fcg_ucc_getcdinfo_byids_cp` 已返回空 → 迁 musicu `srfDissInfo/CgiGetDiss`（分页拉全，兼容粘贴链接/搜索点歌单）；测试新增三份 fixture、e2e 4a-14、browser 4 条 | 6 套全绿（194/267/11/95/16/103） |
| 2026-09-24 | 真机验证（P3.4） | 手机（Android 真机）真实网络实测：6 分组与 30 卡片（总数 11,619）、`R&B` 实体解码与「摇滚」筛选、点卡片 → **真实歌单 66 首完整加载**（另一次 21 首）并跳转播放列表页；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P3.5 | 每日推荐：QQ 无「每日30首」直连接口（`get_radio_track` 匿名出歌少且多助眠白噪音）→ 用雷达 `GetRadarSong` 循环取页 + 跨页按 mid 去重凑 30 首；新增 `src/api/qq/daily.js`（parseRadarSongs / fetchDailySongs）+ `src/views/DailyView.vue`（换一批 / 播放全部 / 未登录提示）+ `/daily` 路由与侧栏「发现·每日推荐」入口；测试新增 2 份 fixture、平台第 20 节、e2e 4a-15、browser 2 条；顺带修复搜索用例按文案选侧栏项（发现组新增入口后不能再取第一个 `.nav-item`） | 6 套全绿（198/271/11/97/16/107） |
| 2026-09-24 | 真机验证（P3.5） | 手机（Android 真机）真实网络实测：日推 30 首渲染（去重无重复、标题/歌手/时长正确）、`播放全部` → 首曲 `螺旋 - RASEN - Acoustic Ver.-` B站匹配成功并播放（`9Lana · B站音源`，playing=true）；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P3.6 | 私人 FM：真机双端复测 `get_radio_track`（匿名 + 登录 Cookie）均只出 1~3 首/次且全为「睡前」助眠音频 → 改与日推同源用雷达；新增 `src/api/qq/fm.js`（`fetchFmBatch` 跨页去重 + `exclude`）+ `src/views/FmView.vue`（连续播放队列剩 ≤4 首自动补 10 首 / 不喜欢换一首 / 换一批）+ `appendToQueue`（批量入队、不弹 toast）+ `/fm` 路由与侧栏入口；测试新增 e2e 4a-17（3 项）+ browser 3 条 | 6 套全绿（198/274/11/100/16/110） |
| 2026-09-24 | 真机验证（P3.6） | 手机（Android 真机）真实网络实测：FM 首屏 10 首（唯一）、「不喜欢」首行移除并补新（首行变化、仍 10 首、无重复）、播放进入播放器（`夢遊 · tayori · B站音源`）、**跳到第 8 首触发自动补货**（队列 10→20、列表 10→20，无重复）；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P3.7 | 歌手页：`src/api/qq/artist.js`（详情/单曲/专辑/相似歌手 4 个 parser + 头像按 mid 构造）+ `ArtistView.vue`（`/artist/:mid`，四 Tab、简介展开、专辑/相似歌手可跳转）+ 搜索歌手项入口；测试新增 4 份 fixture、平台第 21 节（6 项）、e2e 4a-18（4 项）、browser 2 条 | 提交 `21e5dff`；基线 204/278/11/102/16/112 |
| 2026-09-24 | P3.8 | 专辑页：`fetchAlbumDetail`（musicu `GetAlbumDetail`，`albumMId`）+ `AlbumView.vue`（`/album/:mid`：元信息增强 + 播放全部 + 曲目）+ 入口统一（搜索/歌手页/侧栏收藏）；测试新增 2 份 fixture、平台第 22 节（3 项）、e2e 4a-19（2 项）、browser 2 条 | 6 套全绿（211/284/11/107/16/117） |
| 2026-09-24 | P3.9 | 歌曲详情页：`src/api/qq/songDetail.js`（相似歌曲 `GetSimilarSongs` + 评论 `fcg_global_comment_h5`，含 `[em]` 清理）+ `SongDetailView.vue`（`/song/:id` + 入口 query 带展示字段：歌曲头 / 相似歌曲 / 热评 / 最新评论 / 加载更多）+ **全屏播放器顶栏「歌曲详情」入口**（放最后，不影响既有顶栏用例）；测试新增 2 份 fixture、平台第 23 节（4 项）、e2e 4a-20（4 项）、browser 3 条 | 6 套全绿（211/284/11/107/16/117） |
| 2026-09-24 | 真机验证（P3.7–P3.9） | 手机（Android 真机）真实网络实测：**歌手页**（周杰伦：粉丝 5078.5 万 / 1012 单曲 / 43 专辑 / 808 MV，热门 24 首、单曲 30、专辑 20 卡片、相似 5 位）；**专辑页**（十一月的萧邦 + November's Chopin / 2005-11-01 / 杰威尔音乐有限公司 / 12 首）；**歌曲详情**（夜曲：相似 12 首、评论 25 条、总数 77208 条，播放/查看专辑可用）；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P4.0 | 写操作基础设施：`src/api/qq/write.js`（canWrite / writeCall / writeError 三处错误源 + 码表）、`src/store/write.js`（票据守卫 + 统一错误 toast）、`ConfirmDialog.vue` + `askConfirm()`（历史清空接入通用弹窗，替换「点两次」内联模式）、`invalidateLibrary` 统一失效、`mapSong` 补 `songType`；测试平台第 24 节 + e2e 4a-21 | 6 套全绿（221/291/11/108/16/118） |
| 2026-09-24 | P4.1 | 红心：`src/api/qq/fav.js`（批量回显 + 加/删）+ `src/store/fav.js`（状态缓存 / 乐观更新 / 失败回滚 / 成功后失效 liked）+ UI（SongRow·PlayerBar·NowPlaying 三处红心，列表进入自动回显）+ `heart` 图标；测试平台第 25 节 + e2e 4a-22 + browser 3 条（demo cookie 补假 qm_keyst 以覆盖写票据路径） | 6 套全绿（221/291/11/108/16/118） |
| 2026-09-24 | 真机验证（P4.0/P4.1） | 手机（Android 真机）：重登录后 `qm_keyst` 已拿到；**80105 定位与解决**：musicu 写被拦 → 改用签名网关 `musics.fcg` + zzc 签名后写入生效（AddSonglist code 0 → 读回 true → DelSonglist → 读回 false）；**红心 UI 全链路实测**：点红心 → 实心「已喜欢」+「已加入「我喜欢」：夜曲」；再点 → 复原 +「已从「我喜欢」移除」；账号状态最终读回 false（无残留）；截图 已留存于本地验证材料 | 通过 |
| 2026-09-24 | P4.4/P4.6/P4.7 | 歌单管理：`playlistWrite.js`（创建/删除/批量加歌删歌，50/批 + 500ms）+ store（`askPrompt` 输入弹窗、`ConfirmDialog` 二次确认、乐观侧栏更新、轻量刷新当前歌单）+ UI（侧栏「新建歌单」与 hover 删除、歌单页头部「加入歌单/删除歌单」、歌曲行「加入歌单/从歌单移除」、`AddToPlaylistDialog` 选择器）；`PlaylistView` 空歌单也渲染头部（此前空态吞掉删除入口）；D2/D3/D5/D8/D9 参数/模块未破解 → ⏸ 并记录探测矩阵 | 6 套全绿（229/297/11/113/16/123） |
| 2026-09-24 | 修复 | `MediaControlService`：`onCreate`/`onStartCommand` 开头即 `startForegroundCompat()`（占位通知先进前台）；**并修复真机启动即崩的根因竞态**：`mediaSession.push()` 在「启动时无当前曲」也会调 `mediaControlClear()` → `stopService`，与恢复播放触发的 `startForegroundService` 竞态，系统判定前台服务未完成 → 进程被杀（`ForegroundServiceDidNotStartInTimeException`）。改为**只有「原本在播 → 变没歌」才清理通知**（`hadSong` 标记） | 构建通过；重启后真机启动稳定（pid 常驻） |
| 2026-09-24 | 真机验证（P4.4/P4.6/P4.7） | 手机（Android 真机）真实网络：创建「BMP 临时歌单（勿留）」→ 侧栏出现 → 单曲「加入歌单」（侧栏计数 1、打开歌单服务端读回 1 首）→「从歌单移除」（读回 0 首 + toast）→ **空歌单头部渲染 + 头部「删除歌单」二次确认删除**（侧栏消失）；随后完整往返复验「BMP 演示歌单」：输入弹窗创建 → 头部截图（含加入/删除入口）→ 删除；服务端 `fcg_user_created_diss` 终检只剩 3 个系统歌单（无残留） | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | P4.2/P4.3（抓包/源码 spike + 实现） | 抓包路线：MuMu NX 15.0（x86_64/Android 15，`adb root` 可用）已装 frida-server 16.5.9 ✓，但 QQ 音乐手机版 arm64-only（`INSTALL_FAILED_NO_MATCHING_ABIS`）、车机版启动 SIGSEGV、ARM bridge 未启用 → 改用**源码路线**：`L-1124/QQMusicApi` 直接给出 D2/D3 正确方法名与参数；实现 `favWrite.js`（乐观/回滚）+ 专辑页与歌单页收藏入口；平台第 27 节（4 项）+ e2e 4a-24（6 项）+ UI demo（+2） | 6 套全绿（233/303/11/115/16/125） |
| 2026-09-25 | 真机验证（P4.2/P4.3，接口层） | 手机（Android 真机）真实网络：专辑「十一月的萧邦」`FavAlbum`（真实数字 id 60671）→ `CgiGetAlbumFavInfo` 读回 5→6 张含该专辑 → `CancelFavAlbum` → 5 张（复原）；公开歌单 `FavPlaylist` → 读回含该歌单 → `CancelFavPlaylist` → 0（复原）。UI 端到端因手机被占用（WebView 后台节流）未跑，已由 demo mock 覆盖 UI↔store 链路 | 通过（接口层；账号无残留） |
| 2026-09-25 | P4 spike 收尾 | D2/D3 由源码路线解决并落地；D5/D8/D9 记录负结论（D9 旧 Web 接口已死、musicu 写方法无法判定；D8 模块名未知；D5 参数未破解）；抓包路线受阻于 MuMu ARM 翻译（见设备记录） | 已记入第 5 节；D5/D8/D9 保持 ⏸ |
| 2026-09-25 | P6.0–P6.5 | 下载与离线（降级范围）：`core/downloads.js` 能力桥 + 原生 `Directory.Data/bmp-downloads`（持久，不随 Cache 清理）+ `store/downloads.js`（解析直链/索引/并发 2 队列/失败重跑/本地导入）+ `player.js` 本地优先播放（`source='local'`，seek 可用）+ `/storage` 存储管理页（下载/本地音乐/音频缓存统计与清理、导入文件）；入口：歌曲行与播放器底栏下载按钮、歌单页「下载全部」、侧栏「下载与存储」；Web 隐藏下载入口 | 6 套全绿（238/310/11/117/16/125） |
| 2026-09-25 | 真机验证（P6） | 手机（Android 真机）真实网络：搜索「稻香」→ 播放（B站/QQ 音源）→ 播放器底栏「下载」→ **2.6MB m4a 下载完成**（索引 done · QQ音源）→ 重新播放命中本地文件（seek 可用 + 「本地播放」徽标）；`/storage` 显示 已下载 1 首 · 2.6MB、音频缓存 **496.9MB**；本地导入管线（写文件 + 索引 + 重载 + 播放）与「移除」清理（文件删除 ✓）；已知限制：iframe-only 音源无法下载（会失败提示） | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | P7.1 G2 | 付费受限识别：`parseSongUrlInfo`（purl/104003/purl 空/其它码 → 可播/vip_required/copyright_unavailable/url_unavailable）；`mapSong` 与搜索结果带出 `payplay`/`hasPreview`；歌曲行与搜索行 `data-vip` VIP 标注（CSS `::after`，不污染歌名 textContent）；播放回退原因细化（会员/VIP/无直链分别提示）；下载错误提示带受限原因。匿名探测确认 vkey 无票据时 `code=1000`（受限码需登录态，映射按社区码值 + fixture 覆盖） | 243/313/11/118/16/128 全绿 |
| 2026-09-25 | P7.3 G4 | 听歌报告：`api/stats.js` 纯函数（事件上限 5000、时长只增不减、汇总/Top/时段/每日/范围过滤、时长格式化）+ `store/stats.js`（播放开始记事件、timeupdate 累积、4s 延迟落盘 + 暂停/切歌/释放 flush）+ 播放器钩子 + `/report` 页（范围切换 / 4 卡 / 歌曲与歌手 Top10 / 24 小时与每日柱状图 / 二次确认清空）+ 侧栏「听歌报告」入口 | 253/317/11/122/16/130 全绿 |
| 2026-09-25 | P7.4 G5 | 歌单导入导出：JSON（`bmp-playlist` v1，含 mid/数字 id/歌手/时长）+ m3u（EXTINF + songDetail 链接）；导出 App 写 `Directory.External/bmp-exports`（Web Blob 下载）；导入 = 解析 → `CgiGetTrackInfo` 批量补数字 songId（写歌单必需）→ 无 mid 条目搜索补全 → 二次确认 → `AddPlaylist` + `AddSonglist`（跳过补不全的条目并提示）；UI：歌单页导出菜单、侧栏导入按钮、导入进度横幅。修 2 个问题：Capacitor `writeFile` 文本需显式 `encoding:'utf8'`（否则按 base64 解码乱码）；红心 mock 的 `AddSonglist` 匹配收窄到 `dirId=201`（否则截断歌单导入的批量加歌） | 261/323/11/125/16/135 全绿 |
| 2026-09-25 | 真机验证（P7.4） | 手机（Android 真机）：我喜欢的音乐（647 首）→ 导出 JSON（143KB 有效 UTF-8，`format: bmp-playlist`）+ m3u（60KB，`#EXTINF:201,Guiano/理芽 - …` + songDetail 链接）→ 文件落在 `Android/data/<包名>/files/bmp-exports/`；截图已留存于本地验证材料。导入在真机需系统文件选择器（未做端到端，demo/e2e 覆盖） | 通过 |
| 2026-09-25 | P7.2 G3 | 多账号切换：`store/accounts.js`（`bmp:accounts` 最多 5 个，按 uin 去重、最新在前；切换 = 保存当前 → 二次确认 → `loginWithCookie` 重载；删除仅本机）+ 设置页账号区。修 2 个问题：模板里 `isLoggedIn.value` 被自动解包导致「保存当前账号」恒禁用（改 `!isLoggedIn`）；`diagnostics.js` 直接引用 `location` 在非浏览器（e2e）下抛错（加 `typeof location` 守卫） | 261/331/11/125/16/137 全绿 |
| 2026-09-25 | P8.1 H1 | 主题：CSS 变量双套（暗色默认 + `[data-theme='light']`）+ `store/theme.js`（纯函数 `resolveTheme`、`setTheme` 持久化 `bmp:config.theme`、system 监听 `prefers-color-scheme`）+ 设置页主题选择（立即生效）+ 启动挂载前 `initTheme`；顺带补齐 `--card/--line/--hover/--accent` 别名（修复 P6/P7 组件里 var 未定义导致卡片边框缺失） | 264/335/11/131/16/139 全绿 |
| 2026-09-25 | 真机验证（P8.1） | 手机（Android 真机）：设置 → 主题 → 亮色：`html[data-theme=light]`、body `rgb(244,244,247)`、`bmp:config.theme=light`，界面整体切换正常 | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | P8.2 H2 | 迷你播放器：原生服务新增迷你悬浮卡（歌名/歌手 + prev/play/next/close，拖动位置记忆、与桌面歌词互斥、App 可见时隐藏）+ 插件方法 + 能力桥 + store（持久化/权限/同步/事件回 JS）+ 播放器入口。修 2 个问题：`attachDrag` 泛化时把 `miniParams` 传在创建前（NPE 风险，已调整顺序）；store 需 re-export `hasMiniPlayer` 供 UI gating | 264/338/11/132/16/140 全绿 |
| 2026-09-25 | 真机验证（P8.2） | 手机（Android 真机）：播放稻香 → 开启迷你播放器 → 按 Home 后悬浮卡「稻香 (Demo) / 周杰伦 + 控制键」显示在桌面 → 点暂停（`dispatch miniToggle`，JS 暂停）→ 点下一首（`dispatch miniNext`，JS 切歌）→ 点关闭（`miniClosed`，卡片消失）→ 回 App 按钮恢复未开、`bmp:mini-player=false` | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | P8.3 H3 | 桌面小组件：`MiniWidgetProvider`（4x1：歌名/歌手 + 播放暂停/下一首 + 点卡片开 App；按钮 PendingIntent 复用服务 ACTION_TOGGLE/NEXT）+ 布局/描述/背景资源 + 清单注册 + 服务 `updateNotification` 推送并写 `widgetTitle/Artist/Playing` 快照 | 339 全绿；P8 完成 |
| 2026-09-25 | 真机验证（P8.3） | 手机（Android 真机）：`dumpsys appwidget` 可见 provider 已注册；播放稻香后 `bmp-overlay` 快照为 `widgetTitle=稻香 / widgetArtist=周杰伦 / widgetPlaying=true`（服务推送链路 OK）。把小组件拖到桌面是启动器手动步骤，本次未自动完成（后续可手动补验） | 部分通过（provider + 推送已验证） |
| 2026-09-25 | P8.4 B1b | 逐字歌词 / 罗马音：`GetPlayLyricInfo(qrc/roma/trans)` 响应为 **hex 加密**（QQ 变体 3DES + zlib，XML 包裹 `LyricContent`）→ `utils/qqc3des.js`（MIT 参考移植；`DecompressionStream` 按 8 字节填充宽容重试）+ `utils/qrc.js`（解析/合并/词进度）+ `fetchLyric` 解密优先、明文 LRC 回退 + 缓存 v3 + NowPlaying 逐字渲染（`--wp` 渐变）与罗马音行 + 开关持久化；顺带修复 `bmp:config` 默认值不与已存配置合并（老用户拿不到 `lyricQrc` 等新默认值） | 283/348/11/134/16/144 全绿 |
| 2026-09-25 | 真机验证（P8.4） | 手机（Android 真机）：中文「稻香」（本地播放）逐字随播放推进（词数 14；两次快照 done 2→13、activeIdx 2→13、`--wp` 27%→16%，截图 已留存于本地验证材料）；日文「花譜 - Replaceable Goodbye」39 行 + 罗马音行（`shi ：sa sa ga wa ma o` 等，开关持久化 `lyricRoma=true`，截图 已留存于本地验证材料） | 通过 |
| 2026-09-25 | UI 优化（一） | 移动端布局：① `ActionSheet.vue` 通用底部动作面板 + 歌曲行瘦身（常显仅 ♥/⬇/⋯，重新匹配/加入歌单/下一首/B站/移除收进面板；`.bili-link` 移动端隐藏修复图标文字上下堆叠；隐藏 `.t-match` 统一行高）；② 播放页压缩（`.np-foot` 改单行圆形图标；逐字/罗马音/校准/桌面歌词合并为一行 `.lyric-tools`；歌词视图隐藏重复歌名）；③ 歌词信息行/版权行（`markCreditLines` 标记 QRC 首行「歌名 - 歌手」为 credit（弱化、不参与卡拉OK）；翻译版权行（TME/享有本翻译作品…）过滤；缓存升级 `bmp:lyric4:` 并在缓存命中时补标记） | 291/348/11/136/16/147 全绿 |
| 2026-09-25 | 真机验证（UI 优化一） | 手机（Android 真机）：歌曲行 3 个操作（♥/⬇/⋯）、行高统一 66px、无 B站链接堆叠；播放页歌词列表 **550px**（此前约 350px）、工具条一行（逐字/罗马音/−0.5s/未校准/+0.5s/重置/桌面歌词）、底部 4 个圆形图标；credit 行弱化（opacity 0.72）且无版权翻译行 | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | UI 优化（二） | ① 顶栏语境化：`TopBar` 仅在歌单页（`/`）显示「歌单内筛选 + 已匹配 + 一键匹配」，其它页面隐藏（保留侧栏/搜索/设置；非歌单页的搜索入口不带筛选词）；② 歌单头部移动端收敛：`hdr-desktop`（清空匹配/加入/收藏/删除/下载/导出）在移动端隐藏，改由 `hdr-mobile`「更多」打开 `ActionSheet`（加入歌单/收藏歌单/下载全部/导出 JSON/导出 m3u/清空匹配缓存/取消）；③ 搜索联想下拉加淡入动画 | 291/348/11/137/16/147 全绿 |
| 2026-09-25 | 真机验证（UI 优化二） | 手机（Android 真机）：搜索页顶栏仅 侧栏/搜索/设置（无筛选框/徽标/一键匹配）；歌单页头部 3 按钮（播放全部/一键匹配 B 站/更多）+「更多」面板 7 项（含导出 JSON/m3u、收藏歌单）；demo 断言双端通过 | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | P9.1 spike | 听歌识曲调研：QQ 识曲 = ACRCloud 商业授权（无公开接口）；Shazam 非官方端点实测 404 + 需移植专有指纹算法；ACRCloud 自建需付费；原生录音本身可行但无后端。结论：**放弃实现**（与 P5 同列 ⛔，已记入第 5 节与风险表）；顺带修正能力矩阵 C12 状态（P3.9 已完成） | 记录完成 |
| 2026-09-25 | 真机验证（P7.2） | 手机（Android 真机）：设置 → 账号切换 → 保存当前账号 → 强制停止重启后账号列表仍在（`bmp:accounts` 持久化） | 通过（原账号截图仅留本地且已移除登录票据） |
| 2026-09-25 | 真机验证（P7.1/P7.3） | 手机（Android 真机）新构建：搜索热词「稻香」→ 20 条结果 → 播放（**命中 P6 已下载本地文件，source=local**）→ `/report` 实时显示 播放次数 1 · 时长 23 秒（持续累积）· 歌曲/歌手排行 · 时段 18 时柱 · 每日 09-25 柱；`bmp:listen-stats` 事件 `{key: 003aAYrm3GE0Ac, ms: 12029, source: local}` | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | D3 读路径修复（复验发现） | D3 真机 UI 复验发现：`FavPlaylist` 写成功（`result:0`、无失败项）但收藏态 6 秒后被回滚 —— 旧读取接口 `fcg_get_profile_order_asset` 不反映该写入。修复：新增 `music.musicasset.PlaylistFavRead/CgiGetPlaylistFavInfo`（`{uin:euin,offset,size}`，响应字段 **`v_list`**：`tid/name/songnum/logo/nickname`）优先读取、旧接口兜底（`fetchCollectedSmart`）；写结果 `ok/v_failed*` 纳入校验（避免上游静默失败误报成功）；解析保留 dissid/名称兜底 | 平台 268 / e2e 342 全绿 |
| 2026-09-25 | 真机验证(D2/D3 UI 端到端复验) | 手机（Android 真机）真实网络：专辑「十一月的萧邦」→「收藏专辑」→ 按钮「已收藏」+ 侧栏出现（`CgiGetAlbumFavInfo` 服务端复核）→ 取消 → 复原；歌单「甜度爆表 \| 旋律说唱狙击少女心」（66 首）→「取消收藏」（新读路径确认此前写入已生效）+ 启动侧栏回显 → 取消后 6s 按钮/侧栏/重启复核均复原（无残留） | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | 真机验证（P6.3 飞行模式离线） | 手机（Android 真机）：开飞行模式（`cmd connectivity airplane-mode enable`，8 分钟后关闭）→ 冷启动 App → `/storage` 播放已下载「稻香」：np-foot「本地播放」徽标、进度 1:37→1:43（6s 推进）、拖动到 65% 落到 2:26（时长 3:43）、无错误 toast；无匹配歌曲（稻香合唱版）离线播放 → 缓存匹配 + 内嵌播放降级提示「B 站音频流不可用，已改用内嵌播放（不可拖动进度）」且界面响应正常；关飞行模式后「晴天」B站音源恢复播放 | 通过；截图 已留存于本地验证材料 |
| 2026-09-26 | F1–F3 登录健壮性 | ① 轮询连续失败自动重试（`POLL_RETRY_MAX=5`，超限才报错，不再一错即停）；② 二维码生成失败自动退避重试（`START_RETRY_MAX=3`）；③ `visibilitychange` 回前台立即补轮询、终态自动复活；④ 英文报错统一中文映射（含原生 CapacitorHttp 的 `Unable to resolve host` / `Network is unreachable`）；⑤ 请求超时（start 45s / poll 60s，防悬挂卡死 `busy`）；新增 `src/utils/loginRetry.js`（纯函数，平台层第 36 节 10 项）；`auth.js` 超时支持；e2e 登录守卫（+5）；UI 离线 mock 用例（+4，`*auth-api/qr/*` CDP Fetch 拦截，4 个 UI 套件均覆盖） | 平台 301 / e2e 353 / UI 15 / 桌面+演示 139–143 / 移动 20 / 移动+演示 151–155 全绿 |
| 2026-09-26 | 开源前清理 / 包名 / 版本 | 隐私清理：真实 QQ 号改假值（测试/注释/文档）、账号派生 fixture 通用化（`user-created-diss.json`）、公开文档去设备序列号、移除包含登录票据的截图文件；包名中性化 `com.mingyi502.bilimusicplayer` → `com.bilimusic.player`（Java 包目录 / `ACTION_*` / strings / cap config / gradle / 测试路径同步）；版本统一 1.0.0（`package.json` 单一来源，Gradle 读取）；CHANGELOG 增加 `[1.0.0]` | 6 套全绿（301/353/15/139/20/151）+ 新包真机安装 sanity（v1.0.0 + 原生二维码正常） |
| 2026-09-26 | UI 细节修复 | 播放/暂停圆钮改「中性反色」（底 `--text` / 图标 `--bg`；修复浅色主题下「深底 + 深图标」几乎不可见；空队列为 `--hover` 灰底弱图标而非整体透明度）；桌面歌词开关新增专用 `desktopLyric`（显示器 + 歌词线 + 底座）图标，迷你播放器保留 `floatLyric`；browser-test 播放键断言增强为「图标色 ≠ 底色」（全屏 + 迷你条，覆盖浅/深主题） | 6 套全绿（301/353/15/141/20/153）+ 真机 CDP 复验（浅色主题对比度、禁用态、新图标） |
| 2026-09-26 | UI 收尾（rk 行内操作 / 桌面歌词逐字+罗马音 / 登录页默认二维码） | ① 5 个 `.rk-row` 视图（榜单/日推/FM/歌手/专辑）统一接入 `TrackActions`：桌面 播放/下一首/更多，移动端 喜欢/下载/更多（ActionSheet：重新匹配/加入歌单/下一首播放/打开 B 站）；② 桌面歌词解析 QRC 词级进度（8 桶节流）与罗马音，原生 Spannable 逐字着色 + 罗马音行（词级，后台 timeupdate 驱动）；③ `QqLoginActivity` 停用「自动切密码表单」，网页登录默认展示快捷登录二维码；④ 真机复验：桌面歌词逐字/罗马音、网页登录默认二维码、导入歌单端到端（CDP 注入 m3u → 创建/加歌/删歌/删除全链路）+ P4 写操作回归 | 平台 304 / e2e 354 / UI 15 / 桌面+演示 142 / 移动 20 / 移动+演示 152 全绿 |
| 2026-09-26 | P5 E1–E5 | ① E2 评论写：`api/qq/comment.js`（签名网关 `AddComment` 含 `RepliedCmId` / `DelComment`）+ `store/songComments.js`（票据守卫/错误 toast）+ 详情页发表/回复/删除（own 判定按 uin/euin，发后刷新校准）+ 点赞未实现（方法名未找到）；② E3 分享：`utils/share.js`（链接构造）+ `core/share.js` + `@capacitor/share@8.0.2`（App）+ `qrcode@1.5.4` 二维码面板（复制链接/系统分享），详情页与歌单页入口；③ E5 可行部分：`api/qq/follow.js`（`GetFollowSingerList` 只读）+ 设置页「关注的歌手」按需加载（19 位真机验证）；④ E4 收口（候选模块 500003）；测试：平台 §37–39（+11）、e2e 守卫（+2）、UI 用例（评论发表/回复删除 + 分享面板 + 关注歌手，+4） | 平台 321 / e2e 357 / UI 15 / 桌面+演示 144 / 移动 20 / 移动+演示 156 全绿；真机：评论发→删、分享三件套、关注歌手列表 |
| 2026-09-26 | P9 / D5 / D8 / D9 探测收口 | ① 识曲 5 候选模块 → 全部 500003（无公开识别模块，维持不做）；② 云历史 4 候选 → 500003（模块名仍未找到）；③ 关注歌手写 4 候选 → 500003；④ D5 一次性测试歌单试 `ModifyPlaylist`×4 / `EditPlaylist`×3 → 40000/1101、名称未变（负结论维持）；测试数据已清理无残留 | 仅探测与文档记录（无代码变更） |
| 2026-09-26 | P5 点赞探测收口 | ① `CommentWriteServer` 20+ 点赞方法候选 → 500005（方法不存在）；② 12 个点赞候选模块 → 500003；③ `music.globalComment.CommentWrite/PraiseComment {CmId}` → code 0 但读回计数不变（25s 排除缓存）；④ 旧 CGI cmd 未验证出可用路径 | 仅探测与文档（无代码变更）；临时评论全部删除 |
| 2026-09-26 | 依赖升级 | Vite 5.4 → **7.3.6**、`@vitejs/plugin-vue` 5 → **6.0.9**（`plugin-vue@5` peer 不含 Vite 7）；`npm audit` 高危清零（剩 3 个 moderate 来自 `@capacitor/cli → xcode/uuid`，dev 链） | build + build:android 通过；6 套全绿（321/357/15/144/20/156）；cap:sync + gradle 出包 + 真机 sanity（登录态/647 首/播放启动） |
| 2026-09-27 | 逐字歌词渲染重构 | ① 新增 `LyricLine.vue`：仅当前行响应歌词时间（非当前行静态），`--wp` 改 **0.1% 精度**（toFixed(1)）；② 配色统一：未唱 `--text-dim` / 已唱 `--brand` / 当前词品牌绿扫过（边界 1.5% 羽化，删除白色档与 color transition，唱完零跳变）；活动行罗马音/翻译改中性亮灰（不随逐字变绿）；③ iframe 内嵌源：新增 `utils/lyricClock.js`（`extrapolateTime` 纯函数）+ `store/lyric.js` 的 `lyricNow`（2Hz → rAF 外推 ≤480ms，暂停/seek/切源复位）；④ 原生悬浮窗 `buildKaraokeText` 当前词由「绿→白」改为「绿→浅绿」 | 平台 326 / e2e 359 / UI 15 / 桌面+演示 146 / 移动 20 / 移动+演示 158 全绿；真机：rAF 采样 1.5s 内 47 次 `--wp` 更新（步进中位数 14.7%、无回退）、iframe demo 采样 15.1%→55%、悬浮窗无白色跳变 |
| 2026-09-27 | 搜索小增强 | ① 搜索历史单条删除（`removeSearchHistory` + chip 上的 × 按钮）；② 热搜「换一换」：接口取 30 条，视图按 12 条窗口循环轮换（`hotOffset`，不发新请求），排名显示真实序号；fixture `hotkey.json` 扩到 15 条 | 平台 326 / e2e 361 / UI 15 / 桌面+演示 146 / 移动 20 / 移动+演示 160 全绿 |
| 2026-09-27 | 通知栏/迷你卡歌词行 | ① JS：`mediaSession.js` / `miniPlayer.js` 推送当前歌词行（复用 `desktopLyric` 的 `currentLyricLine`）+ 行级 watcher（切歌/无歌词自动回退）；② 原生：`MediaControlPlugin` 透传 `mediaLyric` / `miniLyric`，通知折叠态 `contentText=歌词`、`subText=歌手`（无歌词回退歌手），迷你卡新增第三行歌词（12sp 半透明白，无歌词隐藏）；③ 真机复验：通知栏歌词跨行推进（`曲：笹川真生`→`人並みに`→`世界の終わりみたいな`）、迷你卡三行且歌词更新 | 平台 329 / e2e 363 / UI 15 / 桌面+演示 146 / 移动 20 / 移动+演示 160 全绿 |
| 2026-09-27 | 歌单批量选择 | ① `SongRow` 支持 `selectable/selected`（选择模式下整行=勾选、`#` 列变勾选框、隐藏播放键与行内操作）；② `PlaylistView` 选择模式 + 吸底选择条（全选/取消全选、已选 n 首、加入歌单、下载（App）、从歌单移除（仅自建）、完成），桌面头部「选择」/ 移动端「更多→选择歌曲」入口，切歌单自动退出；③ `playlistWrite.removeSongsFromPlaylist`（批量 + 二次确认 + 乐观计数）；测试：browser demo +3（勾选/全选、选择器、批量移除 DelSonglist 参数）、e2e 守卫 +2；真机复验：更多→选择歌曲、勾选 2/647、全选/取消、完成退出恢复行内操作 | 平台 329 / e2e 365 / UI 15 / 桌面+演示 151 / 移动 20 / 移动+演示 163 全绿 |
| 2026-09-27 | 触屏红心「点了没变化」修复 | ① 真机 CDP 采样定位：点击后 `.on` 类与 `state.fav.map` 均已更新（有成功 toast），但触屏点按后 WebView **粘住 `:hover`**，`.np-act.fav-btn:hover` 把未喜欢的心也染成玫瑰红 → 看起来「取消/添加后状态没变」，退出重进（hover 失效）才恢复；② 修复：`.icon-btn:hover` / `.np-act:hover` / `.np-act.fav-btn:hover` 全部限定 `@media (hover: hover)`（触屏不再有粘滞 hover）；③ 附带：写错误码 2001 中文化（操作过于频繁，保留原始码）；④ 测试：browser 播放器红心用例补计算色断言（类 + 玫瑰红脱钩检查）、e2e 守卫 +2、mobile:demo 弹窗叠层用例先等 toast 清空（修既有时序脆弱）；真机验证：`hover: none` 环境下 `.np-act.fav-btn:hover` 不再命中规则、移除 `on` 后计算色稳定回落 `--text-dim` | 平台 329 / e2e 367 / UI 15 / 桌面+演示 151 / 移动 20 / 移动+演示 163 全绿 |
| 2026-09-27 | 侧栏/队列滑动手势 | `App.vue` 在 `.body` 挂触屏手势（仅窄屏 ≤768px）：都收起时于歌单主页（`route.path === '/'`，与顶栏语境化同判据）**右滑开侧栏、左滑开播放队列**；抽屉展开时左滑收起（任意页面）、队列展开时右滑收起（`QueuePanel.vue` 在 `.queue-overlay` 挂手势，面板铺满时事件不经过 `.body`）；阈值统一 60px 且横向 > 纵向 1.4 倍，方向不符或纵向滚动意图自动放弃；测试：browser 移动端抽屉块 5 条（开/收/非主界面不响应/左滑开队列/右滑收队列）、e2e 守卫覆盖两组件；真机复验：`adb input swipe` 主界面左滑出队列（30 首）、面板右滑收 | 平台 329 / e2e 368 / UI 15 / 桌面+演示 151 / 移动 25 / 移动+演示 168 全绿 |
| 2026-09-27 | 队列侧边栏化 + 冷启动默认展开侧栏 | ① `QueuePanel` 从「底部锚定面板」改为**右侧边栏**：满高、贴右、`min(86vw, 360px)`（手机 340px，与左侧抽屉同宽）、滑入动画 + 左向阴影，去掉底部锚定/圆角与 `calc(100% - var(--player-h))`；② 窄屏冷启动默认展开左侧栏（`App.vue` setup 阶段判定，`location.hash` 为主页时才展开，深链接其它页面不展开）；测试：browser 移动端 +1（默认展开 + 遮罩）、队列用例 +1（几何断言：满高/贴右/窄于视口；桌面与移动 demo 均跑）、e2e 守卫 +1；真机复验：启动即左侧栏、主界面左滑出右侧队列边栏、右滑收起 | 平台 329 / e2e 369 / UI 15 / 桌面+演示 152 / 移动 26 / 移动+演示 170 全绿 |

## 9. 设备验证记录

| 日期 | 设备 | 范围 | 结果 |
|---|---|---|---|
| 2026-09-24 | 模拟器 `emulator-5554`（MuMu，Android 15 / x86_64） | P0 路由与拆分、P1.1 队列、P1.2 历史、P1.3 睡眠定时、P1.4 媒体控制跳过 | 通过；修复 `expandPlayer` 队列恢复缺陷（见变更记录） |
| 2026-09-24 | 模拟器 `emulator-5554` | P2 歌词（真实 QQ 歌曲 59 行 + 缓存 + 点击定位 + 高亮） | 通过；修复模块级请求绕过原生拦截器的 404（`main.js` 动态导入，见变更记录） |
| 2026-09-24 | 模拟器 `emulator-5554` | P2.4 歌词同步（校准工具条/持久化、B站 `t=90` 实测生效、rAF 插值 120ms 间隔进度连续变化） | 通过；修复重启恢复队列后播放键禁用（按钮判断改队列长度） |
| 2026-09-24 | 模拟器 `emulator-5554` | P2.5 + P2.6（默认歌词视图、`だきしめるまで。` 27 行歌词 25 行中文翻译、缓存 v2 与旧键清理、`//` 占位过滤） | 通过；翻译数据来自 musicu `PlayLyricInfo` + `trans:1` |
| 2026-09-24 | 模拟器 `emulator-5554` | P1.4b + P2.3（通知栏 MediaStyle + 封面 + 3 动作；`keyevent 85/87` 播放暂停 / 切歌；悬浮窗窗口 + 歌词/翻译实时推送 + 重启恢复；Web 隐藏入口） | 通过；修复布尔持久化 bug（`1/0` vs JSON 布尔） |
| 2026-09-24 | 手机（Android 真机） | P2.3b 桌面歌词卡片：前台隐藏 / HOME 后显示 / 卡片按钮（上一首/暂停/下一首/关闭）/ 通知 4 动作 / 开关同步 | 通过；修复拖拽监听拦截按钮（见变更记录） |
| 2026-09-24 | 手机（Android 真机） | P1.1c 通知栏 seek：CDP 点 App 进度条 70% → session 位置即时 142s（≈70%）；通知栏进度条跟随真实播放（02:54/03:23）不再回弹 | 通过 |
| 2026-09-24 | 手机（Android 真机） | P1.1c 大跨度 seek：App 内 141s 跳转采样 8s（70.02%→73.88% 单调，无 dip）；通知栏直接点 70% → `onSeekTo` 乐观更新 + JS 36ms 确认，session 稳定 141853 后继续推进 | 通过 |
| 2026-09-24 | 手机（Android 真机） | P3.1 综合搜索（真实网络）：四类 Tab 结果渲染与总数、歌单 HTML 实体解码、歌手聚合（周杰伦 20 首相关单曲）、搜索结果点播（B站匹配 `稻香`，playing=true） | 通过；截图已留存于本地验证材料（本机临时目录） |
| 2026-09-24 | 手机（Android 真机） | P3.2 热搜与联想（真实网络）：热搜 12 条 + 点击搜索、联想 8 条分组 + 点击搜索；输入联想支持 ↑↓/Enter/Esc | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.3 排行榜（真实网络）：4 分组 / 30 榜卡片、默认热歌榜 50 条（排名与歌手/时长正确）、切飙升榜（涨幅 15%）、播放全部（茶汤 · B站音源） | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.4 歌单广场（真实网络）：分类/排序/卡片墙（30 张，总数 11,619）、切流派→摇滚、点卡片真实加载歌单 66 首并跳转 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.5 每日推荐（真实网络）：雷达凑满 30 首（无重复）、换一批/播放全部、首曲 B站匹配播放成功 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.6 私人 FM（真实网络）：首屏 10 首唯一、「不喜欢」换歌、播放（夢遊 · B站音源）、跳至第 8 首触发自动补货（队列/列表 10→20 无重复） | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.7 歌手页（真实网络）：周杰伦详情/热门 24/单曲 30/专辑 20 卡片/相似 5 位；简介 252 字 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.8 专辑页（真实网络）：译名/发行日/公司（杰威尔音乐有限公司）/简介 2069 字/12 首曲目 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P3.9 歌曲详情（真实网络）：夜曲相似 12 首、评论 25 条（总 77208）、播放与查看专辑可用 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P4.0/P4.1 写操作（真实网络）：musicu 写被 80105 拦 → 签名网关 musics.fcg + zzc 签名写入生效；红心 UI 加入/移除全链路通过，服务端读回一致，账号复原 | 通过；截图 已留存于本地验证材料 |
| 2026-09-24 | 手机（Android 真机） | P4.4/P4.6/P4.7 歌单管理（真实网络）：创建 → 加入 1 首（服务端读回）→ 移除（读回 0）→ 空歌单头部删除（二次确认）→ 列表复原；完整往返复验（输入弹窗创建 → 头部截图 → 删除）；服务端终检无残留 | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | 手机（Android 真机） | P4.2/P4.3 收藏专辑/歌单（真实网络，接口层）：`FavAlbum`/`CancelFavAlbum`（读回 5→6→5）、`FavPlaylist`/`CancelFavPlaylist`（读回 0→1→0），账号复原 | 通过（UI 端到端待手机空闲补验） |
| 2026-09-25 | 模拟器 `127.0.0.1:5555`（MuMu NX 15.0，x86_64/Android 15） | 抓包环境：`adb root` ✓、frida-server 16.5.9 注入 ✓、QQ 音乐安装受阻（手机版 arm64-only / 车机版 SIGSEGV / ARM bridge 未启用） | 环境就绪但目标 App 不可运行；改用源码路线解决 D2/D3 |
| 2026-09-25 | 手机（Android 真机） | P6 下载与离线：稻香下载 2.6MB（QQ音源）→ 本地播放徽标 + seek；存储页统计（下载 1/2.6MB、缓存 496.9MB）；本地导入与移除清理 | 通过；截图 已留存于本地验证材料（测试导入条目已清理；保留 1 首真实下载） |
| 2026-09-25 | 手机（Android 真机） | P7.3 听歌报告：热词搜索「稻香」→ 播放命中本地下载（source=local）→ `/report` 实时统计（1 次 · 23 秒 · 稻香/周杰伦 Top1 · 18 时柱 · 09-25 柱） | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | 手机（Android 真机） | P7.4 导出：我喜欢的音乐 647 首 → JSON（143KB）+ m3u（60KB）写入 `bmp-exports/`，内容校验通过 | 通过；截图 已留存于本地验证材料 |
| 2026-09-25 | 手机（Android 真机） | P7.2 多账号：保存当前账号 + 重启后持久化 | 通过（账号截图含登录票据，已从仓库移除） |
| 2026-09-26 | 手机（Android 真机） | F1–F3 登录健壮性真机复验（飞行模式断网）：F2 生成失败自动重试（1/2 → 2/2 → 中文终态「网络连接失败」，无英文直出）→ 恢复网络刷新出图；F1 轮询失败自动重试（2/5→5/5、二维码保留无遮罩）→ 终态；F3 恢复网络 + HOME/回前台 → 终态自动复活为「二维码未失效」等待态；测前测后 localStorage 登录态可逆切换（queue 500 / matches 32 / accounts 1 无丢失） | 通过；截图 已留存于本地验证材料 |
| 2026-09-26 | 手机（Android 真机） | H3 小组件复验：播放中 `dumpsys appwidget` provider 注册（`.MiniWidgetProvider`，4x1）+ `bmp-overlay` 快照 `widgetTitle/widgetArtist/widgetPlaying=true` 推送正确；「拖到桌面」为启动器手动步骤，本轮未执行（留待手动补验） | 自动部分通过 |
| 2026-09-26 | 手机（Android 真机） | 包名中性化后新包（`com.bilimusic.player`）首次安装 sanity：版本 v1.0.0、全新未登录态、设置/登录弹窗正常、原生扫码二维码生成成功（旧包保留，数据不互通） | 通过 |
| 2026-09-26 | 手机（Android 真机） | 桌面歌词逐字 + 罗马音：后台悬浮窗按词着色（已唱绿 / 当前词按进度绿→白 / 未唱灰）并显示罗马音行与翻译；连续三帧验证词进度推进 | 通过 |
| 2026-09-26 | 手机（Android 真机） | 网页登录默认二维码：清 WebView Cookie + 可逆未登录态后打开网页登录页，默认「快捷登录」二维码（底部保留「密码登录」入口），不再自动跳密码表单 | 通过 |
| 2026-09-26 | 手机（Android 真机） | 导入歌单端到端 + P4 写操作回归：CDP 注入 m3u → 确认弹窗《BMP-import-test》2 首 → `AddPlaylist` + `AddSonglist`（晴天/稻香，服务端读回）→ 行内「从歌单移除」→ 侧栏删除（二次确认）→ 列表复原无残留 | 通过 |
| 2026-09-26 | 手机（Android 真机） | P5 E2 评论真机：详情页发表「测试评论（应用联调，稍后删除）」→ 刷新可见且带「删除」→ 删除成功，账号无残留 | 通过 |
| 2026-09-26 | 手机（Android 真机） | P5 E3 分享真机：分享面板二维码渲染、复制链接后读取剪贴板内容与链接一致、系统分享面板（`ChooserActivity`）弹出 | 通过 |
| 2026-09-26 | 手机（Android 真机） | P5 E5 关注歌手：设置页按需加载 → 19 位（廻花/AJR/…），头像与歌手页跳转入口正常 | 通过 |

复验工具：`scripts/android-cdp.mjs`（`list` / `eval <expr.js>` / `shot <out.png>`，Node ≥ 22），
前置 adb forward 步骤见 `HANDOVER-LOCAL.md`。真机（Android 真机）待后续原生功能（P1.4b / B4 / H2 / H3）一并验收。
