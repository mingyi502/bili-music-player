# 贡献指南

感谢你愿意为本项目做贡献！请先花几分钟阅读以下约定。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 开发环境

- Web 开发：Node.js **20.19+ 或 22.12+**
- Android 构建：Node.js **22+**、JDK **21**、Android SDK Platform **36**
- 包管理器：npm（保持 `package-lock.json` 一并提交）
- 这是应用仓库，`package.json` 保留 `private: true` 以防误发布到 npm；该设置不影响 GitHub 源码仓库的开源发布

```bash
npm install
npm run dev
```

## 提交前自测

```bash
npm run build
npm run test:platform
npm run test:security
npm run dev        # 另开终端
npm run test:e2e   # 端到端自检，需 dev server 处于运行状态
```

> `test:platform`、`test:security` 和 `build` 可在 CI 运行；`test:e2e` 会访问腾讯 / B 站真实接口，**不要**把它接入 CI，也不要频繁运行。

## 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat:     新功能
fix:      修复 bug
docs:     文档变更
refactor: 重构（不改行为）
perf:     性能优化
test:     测试相关
chore:    构建/依赖/杂项
```

示例：`fix(match): 时长加分不应作用于无文字命中的视频`

## 代码风格

- 2 空格缩进，单引号，不加分号（与现有代码保持一致）
- 组件用 `<script setup>`；工具函数保持纯函数、可测试
- **不要**提交任何密钥、Cookie、`.env`、个人绝对路径
- 涉及网络请求的代码请设置超时，并区分「网络错误」与「业务错误」

## Pull Request

1. 从 `main` 开分支，改动聚焦（一个 PR 做一件事）
2. 说明：改了什么、为什么、如何验证
3. 若修改了界面，请描述验证步骤；如提供截图，只能使用不含账号、歌词、封面和访问口令的合成/脱敏截图
4. 若修改了匹配算法，请补充/更新 `scripts/e2e-test.mjs` 中的用例

## 不接受的内容

- 任何形式的「一键部署到公网」方案（本地代理无鉴权，存在安全风险）
- 绕过付费/版权限制、批量抓取、下载受版权内容的功能
- 引入体积庞大或不必要的依赖
