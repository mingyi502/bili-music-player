package com.bilimusic.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.widget.RemoteViews;

/**
 * 桌面小组件（P8.3 H3）：显示当前歌曲 + 播放/暂停 + 下一首；点卡片打开 App。
 *
 * 状态由前台服务（MediaControlService.updateNotification）在每次变更时推送，
 * 同时写入 bmp-overlay 偏好，供 onUpdate（添加/重启后）恢复最近状态。
 * 控制按钮直接以服务 action 发 PendingIntent，复用通知栏同一条控制链路。
 */
public class MiniWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "BMP-Widget";
    private static final String PREFS = "bmp-overlay";

    static void updateAll(Context ctx, String title, String artist, boolean playing) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit()
                .putString("widgetTitle", title == null ? "" : title)
                .putString("widgetArtist", artist == null ? "" : artist)
                .putBoolean("widgetPlaying", playing)
                .apply();

            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr == null) return;
            ComponentName cn = new ComponentName(ctx, MiniWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;
            RemoteViews rv = build(ctx, title, artist, playing);
            for (int id : ids) mgr.updateAppWidget(id, rv);
            Log.i(TAG, "updateAll n=" + ids.length + " title=" + title + " playing=" + playing);
        } catch (Exception e) {
            Log.w(TAG, "updateAll failed: " + e);
        }
    }

    private static RemoteViews build(Context ctx, String title, String artist, boolean playing) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_mini);
        rv.setTextViewText(R.id.widget_title, title == null || title.isEmpty() ? "未在播放" : title);
        rv.setTextViewText(R.id.widget_artist, artist == null ? "" : artist);
        rv.setImageViewResource(R.id.widget_play, playing ? R.drawable.ic_ov_pause : R.drawable.ic_ov_play);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        rv.setOnClickPendingIntent(
            R.id.widget_play,
            PendingIntent.getService(ctx, 1, serviceIntent(ctx, MediaControlService.ACTION_TOGGLE), flags)
        );
        rv.setOnClickPendingIntent(
            R.id.widget_next,
            PendingIntent.getService(ctx, 2, serviceIntent(ctx, MediaControlService.ACTION_NEXT), flags)
        );
        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        rv.setOnClickPendingIntent(
            R.id.widget_root,
            PendingIntent.getActivity(ctx, 3, open, flags)
        );
        return rv;
    }

    private static Intent serviceIntent(Context ctx, String action) {
        Intent intent = new Intent(ctx, MediaControlService.class);
        intent.setAction(action);
        return intent;
    }

    private static String state(Context ctx, String key, String def) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, def);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] appWidgetIds) {
        String title = state(ctx, "widgetTitle", "");
        String artist = state(ctx, "widgetArtist", "");
        boolean playing = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("widgetPlaying", false);
        RemoteViews rv = build(ctx, title, artist, playing);
        for (int id : appWidgetIds) mgr.updateAppWidget(id, rv);
        Log.i(TAG, "onUpdate n=" + (appWidgetIds == null ? 0 : appWidgetIds.length));
    }
}
