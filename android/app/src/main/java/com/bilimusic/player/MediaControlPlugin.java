package com.bilimusic.player;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 媒体控制插件（P1.4b）+ 桌面歌词（P2.3）。
 *
 * JS 侧：update() 推送播放状态 → 原生 MediaSession/通知栏；
 *        setOverlay()/updateLyric() 控制桌面歌词悬浮窗；
 *        原生播放控制动作通过 "action" 事件回传（play/pause/next/prev/seek）。
 */
@CapacitorPlugin(name = "MediaControl")
public class MediaControlPlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private boolean notificationPermissionRequested = false;

    @Override
    public void load() {
        MediaControlService.setListener((action, value) -> {
            JSObject ret = new JSObject();
            ret.put("action", action);
            ret.put("value", value);
            // 兼容旧字段：seek 用秒
            ret.put("seekTime", value / 1000.0);
            notifyListeners("action", ret);
        });
    }

    /** App 可见 → 隐藏桌面歌词（避免遮挡 App 内歌词页） */
    @Override
    protected void handleOnStart() {
        MediaControlService.setAppVisible(true);
    }

    /** App 退到后台 / 锁屏 → 显示桌面歌词 */
    @Override
    protected void handleOnStop() {
        MediaControlService.setAppVisible(false);
    }

    private void startService(Intent intent) {
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }

    private Intent baseIntent() {
        return new Intent(getContext(), MediaControlService.class).setAction(MediaControlService.ACTION_UPDATE);
    }

    /** Android 13+ 通知需要运行时权限（未授权时前台服务通知可能不显示）；每次启动只申请一次 */
    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || notificationPermissionRequested) return;
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) return;
        notificationPermissionRequested = true;
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    /** 推送播放状态（标题/歌手/封面/播放中/进度/当前歌词行）→ 更新 MediaSession 与通知 */
    @PluginMethod
    public void update(PluginCall call) {
        ensureNotificationPermission();
        Intent intent = baseIntent();
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("album", call.getString("album", ""));
        intent.putExtra("artwork", call.getString("artwork", ""));
        intent.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        intent.putExtra("position", toMs(call.getDouble("position", 0.0)));
        intent.putExtra("duration", toMs(call.getDouble("duration", 0.0)));
        intent.putExtra("mediaLyric", call.getString("lyric", ""));
        startService(intent);
        call.resolve();
    }

    /** 开关桌面歌词悬浮窗 */
    @PluginMethod
    public void setOverlay(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        android.util.Log.i("BMP-Media", "plugin setOverlay " + enabled);
        Intent intent = baseIntent();
        intent.putExtra("overlayEnabled", enabled);
        startService(intent);
        call.resolve();
    }

    /** 更新悬浮窗歌词（当前行 + 翻译 + 罗马音 + 逐字进度） */
    @PluginMethod
    public void updateLyric(PluginCall call) {
        Intent intent = baseIntent();
        intent.putExtra("lyricText", call.getString("text", ""));
        intent.putExtra("lyricTrans", call.getString("trans", ""));
        intent.putExtra("lyricRoma", call.getString("roma", ""));
        intent.putExtra("lyricSung", call.getInt("sung", -1));
        intent.putExtra("lyricProgress", call.getDouble("progress", 0d));
        JSArray words = call.getArray("words");
        intent.putExtra("lyricWords", words == null ? "[]" : words.toString());
        startService(intent);
        call.resolve();
    }

    /** 开关迷你播放器悬浮窗（H2） */
    @PluginMethod
    public void setMiniPlayer(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        android.util.Log.i("BMP-Media", "plugin setMiniPlayer " + enabled);
        Intent intent = baseIntent();
        intent.putExtra("miniEnabled", enabled);
        startService(intent);
        call.resolve();
    }

    /** 更新迷你播放器（歌名 / 歌手 / 播放态 / 当前歌词行） */
    @PluginMethod
    public void updateMiniPlayer(PluginCall call) {
        Intent intent = baseIntent();
        intent.putExtra("miniTitle", call.getString("title", ""));
        intent.putExtra("miniArtist", call.getString("artist", ""));
        intent.putExtra("miniPlaying", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        intent.putExtra("miniLyric", call.getString("lyric", ""));
        startService(intent);
        call.resolve();
    }

    /** 是否已获得「显示在其他应用上层」权限 */
    @PluginMethod
    public void hasOverlayPermission(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getContext());
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** 打开系统设置让用户授予悬浮窗权限（该权限无法用弹窗申请） */
    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开悬浮窗设置：" + e.getMessage());
        }
    }

    /** 退出播放 / 清理通知与悬浮窗 */
    @PluginMethod
    public void clear(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MediaControlService.class));
        call.resolve();
    }

    private long toMs(Double seconds) {
        if (seconds == null || seconds.isNaN() || seconds.isInfinite() || seconds < 0) return 0;
        return (long) (seconds * 1000);
    }
}
