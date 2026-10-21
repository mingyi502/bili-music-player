import { createApp } from 'vue'
import './styles/main.css'
import { initPlatform } from './platform/index.js'

// 先安装平台适配（原生端需要注入 HTTP / 媒体 / 登录实现），再加载并挂载应用。
// ⚠️ 必须动态导入 App / router：静态导入会让 store 等模块在 initPlatform 之前求值，
//    模块级副作用（如歌词自动加载）会绕过原生 HTTP 拦截器，打到 https://localhost 上 404。
// Web 端 initPlatform 立即返回，无额外开销。
initPlatform().finally(async () => {
  const [{ default: App }, { default: router }, theme, { initBackNavigation }] = await Promise.all([
    import('./App.vue'),
    import('./router/index.js'),
    import('./store/theme.js'),
    // 与 App 一起动态加载：避免 store 在 initPlatform 之前求值
    import('./core/back.js'),
  ])
  theme.initTheme()
  createApp(App).use(router).mount('#app')
  // Android 物理返回键：先关弹层 → 返回上一页 → 首页最小化
  initBackNavigation(router).catch((e) => console.error('[back] 返回键注册失败:', e))
})
