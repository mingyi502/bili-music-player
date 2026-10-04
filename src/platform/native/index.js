/**
 * 原生适配组装：把插件与核心的注入点接起来。
 * 只有运行在 Capacitor 容器内时才会被 platform/index.js 动态加载。
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'

import { setHttpInterceptor, setRequestTransport, setMediaResolvers } from '../../core/http.js'
import { setClipboard } from '../../core/clipboard.js'
import { setMediaControlBackend } from '../../core/mediaControl.js'
import { setShareBackend } from '../../core/share.js'
import { setDownloadBackend } from '../../core/downloads.js'
import { setFileBackend } from '../../core/files.js'
import { setImageResolver } from '../../utils/mediaCache.js'
import { setAuthBackend, setWebLogin } from '../../api/auth.js'
import { createNativeHttp } from './http.js'
import { createNativeMedia } from './media.js'
import { createNativeAuth } from './auth.js'
import { createNativeWebLogin } from './qqWebLogin.js'
import { createNativeClipboard } from './clipboard.js'
import { createNativeShare } from './share.js'
import { createNativeMediaControl } from './mediaControl.js'

export function installNative() {
  const http = createNativeHttp({ CapacitorHttp })
  setHttpInterceptor(http.interceptor)
  setRequestTransport(http.requestTransport)

  const media = createNativeMedia({ CapacitorHttp, Filesystem, Directory, FileTransfer, Capacitor })
  setMediaResolvers({ image: media.resolveImage, audio: media.resolveAudio })
  setImageResolver(media.resolveImage)

  setClipboard(createNativeClipboard())

  // 系统分享（P5 E3）：App 走 Capacitor Share；Web 不注入 → 只显示复制链接/二维码
  setShareBackend(createNativeShare())

  // 媒体控制（通知栏 / 锁屏 / 蓝牙按键）+ 桌面歌词（P1.4b / P2.3）
  setMediaControlBackend(createNativeMediaControl())

  // 下载 / 本地音乐（P6）：持久目录读写与统计
  setDownloadBackend({
    downloadAudio: media.downloadAudio,
    downloadedFileInfo: media.downloadedFileInfo,
    removeDownloadedFile: media.removeDownloadedFile,
    writeLocalMusic: media.writeLocalMusic,
    removeLocalMusic: media.removeLocalMusic,
    dirSize: media.dirSize,
    clearDir: media.clearDir,
    clearAudioCache: media.clearAudioCache,
    audioCacheSize: () => media.dirSize(media.dirs.AUDIO_DIR, Directory.Cache),
    dirs: media.dirs,
  })

  // 文本导出（P7.4 G5）：App 写入 External 专属目录，Web 端走 Blob 下载
  setFileBackend({ saveTextFile: media.saveTextFile, dir: media.dirs.EXPORT_DIR })

  const auth = createNativeAuth({ transport: http.transport })
  setAuthBackend(auth)

  const webLogin = createNativeWebLogin(registerPlugin('QqWebLogin'), {
    finish: (cookie) => auth.exchangeWebLogin(cookie),
  })
  setWebLogin(webLogin)

  return {
    platform: Capacitor.getPlatform(),
    clearAudioCache: media.clearAudioCache,
    clearWebLoginCookies: webLogin.clear,
    dispose: auth.dispose,
  }
}
