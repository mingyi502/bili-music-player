/**
 * 移动端媒体控制适配层（Capacitor 插件 MediaControl）。
 *
 * 原生侧（android/.../MediaControlPlugin.java + MediaControlService.java）负责：
 * MediaSession、前台服务 + 通知栏、桌面歌词悬浮窗。
 */
import { registerPlugin } from '@capacitor/core'

const MediaControl = registerPlugin('MediaControl')

export function createNativeMediaControl() {
  return {
    async update(payload) {
      await MediaControl.update({
        title: payload?.title || '',
        artist: payload?.artist || '',
        album: payload?.album || '',
        artwork: payload?.artwork || '',
        playing: !!payload?.playing,
        position: Number(payload?.position) || 0,
        duration: Number(payload?.duration) || 0,
        lyric: payload?.lyric || '',
      })
    },
    async clear() {
      await MediaControl.clear()
    },
    async setOverlay(enabled) {
      await MediaControl.setOverlay({ enabled: !!enabled })
    },
    async updateLyric(payload) {
      const p = payload || {}
      await MediaControl.updateLyric({
        text: p.line || '',
        trans: p.trans || '',
        roma: p.roma || '',
        words: Array.isArray(p.words) ? p.words : [],
        sung: Number.isInteger(p.sung) ? p.sung : -1,
        progress: Number(p.progress) || 0,
      })
    },
    async hasOverlayPermission() {
      const r = await MediaControl.hasOverlayPermission()
      return Boolean(r && r.granted)
    },
    async requestOverlayPermission() {
      await MediaControl.requestOverlayPermission()
    },
    async setMiniPlayer(enabled) {
      await MediaControl.setMiniPlayer({ enabled: !!enabled })
    },
    async updateMiniPlayer(payload) {
      await MediaControl.updateMiniPlayer({
        title: payload?.title || '',
        artist: payload?.artist || '',
        playing: !!payload?.playing,
        lyric: payload?.lyric || '',
      })
    },
    onAction(cb) {
      MediaControl.addListener('action', (e) => cb(e || {}))
    },
  }
}
