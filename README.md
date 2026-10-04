# bili-music-player

> 把 QQ 音乐歌单带到本地：自动匹配哔哩哔哩音源，并在浏览器或 Android App 中播放。
>
> [MIT License](./LICENSE) · Web + Android · v1.0.0

> **非官方项目。** 本项目与腾讯（QQ 音乐）、哔哩哔哩（Bilibili）及其关联公司无关，也未获得它们的授权或认可。请只使用自己的账号，并在使用前阅读[隐私说明](./PRIVACY.md)、[安全政策](./SECURITY.md)和下方的[风险与限制](#风险与限制)。

## 项目简介

`bili-music-player` 是一个运行在本机的音乐播放器：导入 QQ 音乐的「我喜欢的音乐」、创建或收藏的歌单和专辑，按歌曲名与歌手匹配哔哩哔哩音源后播放。

- 浏览器版通过本机 Node.js 服务运行，不需要部署服务器。
- Android App 使用 Capacitor 打包，安装后可以脱离电脑运行。
- 登录凭据和播放数据保存在本地，不上传到项目作者的服务器。

当前仓库不提供在线演示或公开账号。请使用自己的账号按下面的快速开始运行。

## 功能

- **曲库**：我喜欢的音乐、创建/收藏的歌单、收藏的专辑、搜索、排行榜、每日推荐、私人 FM、歌手和专辑页面。
- **播放**：默认匹配哔哩哔哩音源，也可切换 QQ 音乐直链；支持队列、最近播放、随机/顺序/单曲循环和睡眠定时。
- **歌词**：LRC 翻译、QRC 逐字歌词、罗马音、歌词校准；Android 支持通知栏、锁屏、蓝牙按键和桌面歌词。
- **离线与管理**：Android 下载和离线播放、本地音乐导入、存储管理、JSON/m3u 导入导出、多账号、听歌报告和主题切换。

## 快速开始

### 环境要求

| 场景 | 要求 |
|---|---|
| Web 开发 | Node.js **20.19+ 或 22.12+** |
| Android 构建 | Node.js **22+**、JDK **21**、Android SDK Platform **36** |

### 启动 Web 版

```bash
npm install
npm start
```

`npm start` 会启动 Vite 开发服务器并尝试打开浏览器。也可以使用 `npm run dev`，然后手动打开 <http://127.0.0.1:5173>。

Windows 用户可以双击 [`start.bat`](./start.bat)；脚本使用 GBK 编码，请不要转换编码。

> **必须通过开发服务器运行。** 应用依赖本地代理和中间件处理 Referer、Cookie、登录会话、图片与音频流；直接双击 `index.html` 或只托管 `dist/` 无法正常工作。

## 第一次使用

1. 在左侧点击「登录 QQ 音乐」，优先使用扫码登录。
2. 登录完成后等待歌单导入，打开「我喜欢的音乐」或任意歌单。
3. 点击歌曲播放；没有匹配记录时，应用会自动搜索哔哩哔哩音源。
4. 需要批量处理时，点击「一键匹配 B 站」；播放条可以切换 B 站 / QQ 音乐音源。

## 登录方式

| 方式 | 浏览器 | Android App | 说明 |
|---|---:|---:|---|
| QQ 扫码登录 | ✓ | ✓ | 推荐方式。应用生成二维码，用手机 QQ 扫码确认。 |
| 手动 Cookie | ✓ | ✓ | 在 `y.qq.com` 登录后导入 Cookie；电脑可从开发者工具复制，App 提供书签小工具。 |
| 腾讯网页登录 | — | 备用 | 仅 Android App 尝试使用；页面由腾讯提供，可能因页面变体或风控失败。 |

### 手动导入 Cookie

- **电脑**：登录 [y.qq.com](https://y.qq.com)，按 `F12` 打开开发者工具，在 Network 中选择一个 `c.y.qq.com` 请求，复制 Request Headers 的整段 Cookie。
- **Android 手机**：在 App 的「手动 Cookie」页面复制书签小工具代码，在浏览器中新建书签并替换网址；登录 `y.qq.com` 后点击书签，返回 App 从剪贴板读取。

Cookie 是登录凭据，请不要提交到 Issue、Pull Request、截图、日志或聊天中。网页登录的实现原理和已验证限制见 [`HANDOVER.md`](./HANDOVER.md)。

## 播放行为

哔哩哔哩是默认音源，应用先按「歌曲名 + 歌手」匹配视频，再尝试获取音频流。

| 情况 | 行为 |
|---|---|
| 音频流可用 | 使用 `<audio>` 播放，进度条可拖动。 |
| 音频流不可用 | 退回内嵌播放器，通常能出声，但本应用无法控制进度。 |
| 找不到匹配视频 | 停止并提示，不会自动切换 QQ 音乐；可以手动搜索或切换音源。 |
| 选择 QQ 音乐音源 | 优先播放 QQ 直链；VIP、版权或区域限制可能导致直链不可用。 |

Web 版通过 `/media-api` 代理音频流；Android 版先下载到应用缓存再播放，首次播放可能等待几秒。

## 手机使用

### Android 独立 App

Android 工程已提交在仓库中。准备 Android Studio、JDK 21、Android SDK Platform 36 和 Node.js 22+ 后：

```bash
npm install
npm run cap:sync
npm run cap:open
```

运行到已连接设备：

```bash
npm run cap:run
```

生成可侧载的 Debug APK：

```bash
cd android
./gradlew assembleDebug
```

以上都是 Debug 构建；正式分发前需自行配置 release 签名。只有缺少 `android/` 目录时才需要 `npm run cap:add:android`。

正式 Web/Android 构建不会显示实验性的「一键登录」入口；它只可能在显式设置 `BMP_SHOW_EXPERIMENTAL=1` 的非 production、非 Capacitor 开发构建中出现。

### USB 连接手机浏览器

```bash
adb reverse tcp:5173 tcp:5173
npm run dev
```

然后打开 <http://localhost:5173>。Windows 用户也可以双击 [`start-usb.bat`](./start-usb.bat)。

### 同一 Wi-Fi 下访问

```bash
BMP_LAN=1 npm run dev
```

终端会显示局域网地址和一次性访问口令。手机连接同一 Wi-Fi 后打开地址并输入口令。局域网模式使用明文 HTTP，只适合家庭或可信网络，不要暴露到公网；详见 [`SECURITY.md`](./SECURITY.md)。

## 数据与隐私

应用不内置分析 SDK、广告 SDK、崩溃上报或远程用户画像。Cookie、账号快照、播放队列、历史、匹配缓存、歌词缓存和主题设置保存在浏览器或 Android WebView 本地存储中；Android 下载音频、本地音乐和导出文件也在设备本地。

主动登录、搜索、播放、评论、收藏、歌单管理或匹配音源时，请求会发送到 QQ 音乐、哔哩哔哩及其 CDN。项目作者不会把这些数据发送到自有服务器。完整说明见 [`PRIVACY.md`](./PRIVACY.md)。

## 开发与测试

```bash
npm install
npm run dev
npm run build
npm run build:android
npm run cap:sync
```

基础测试：

```bash
npm run test:platform
npm run test:security
```

`test:e2e` 需要先运行开发服务器，并会访问腾讯、哔哩哔哩真实接口：

```bash
npm run dev          # 终端 A
npm run test:e2e     # 终端 B
```

UI 测试：

```bash
npm run test:ui
npm run test:ui:mobile
npm run test:ui:demo
npm run test:ui:mobile:demo
```

UI 测试通过 Chrome DevTools Protocol 启动 Windows 标准路径下的 Chrome 或 Edge。`--demo` 只由测试脚本注入合成数据，应用没有普通用户可开启的演示模式。更多架构和验证记录见 [`HANDOVER.md`](./HANDOVER.md)。

## 架构概览

```text
Vue 3 UI
  │
  ▼
src/store  ── 状态、播放队列、歌词、下载、导入导出
  │
  ▼
src/api    ── QQ 音乐 / 哔哩哔哩接口封装
  ├─ Web：Vite 本地中间件代理
  └─ App：Capacitor 原生 HTTP 直连上游
```

平台无关的请求适配在 [`src/core/`](./src/core/)，平台实现位于 [`src/platform/`](./src/platform/)，本地服务端中间件位于 [`server/`](./server/)。

## 风险与限制

- 非官方第三方接口、登录页面和风控策略随时可能变化。
- QQ 音乐 VIP/版权限制可能导致直链不可用；哔哩哔哩搜索可能限流。
- Clash TUN 等代理配置可能导致哔哩哔哩音频流失败，详见 [`SECURITY.md`](./SECURITY.md)。
- 内嵌播放器无法提供完整进度控制；Android 音频缓存可能被系统回收。
- 项目设计为单机或可信局域网使用，不支持公网部署或共享服务器。
- 请遵守第三方平台协议、版权规则和适用法律；MIT 许可证只覆盖本项目代码。

## 维护、贡献与许可证

- 维护者请先阅读 [`HANDOVER.md`](./HANDOVER.md) 和 [`ROADMAP.md`](./ROADMAP.md)。
- 贡献代码前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 和 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
- 安全问题请按 [`SECURITY.md`](./SECURITY.md) 私下报告。
- 本项目按 [`MIT License`](./LICENSE) 发布；第三方代码和许可证见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
