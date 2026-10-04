package com.bilimusic.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 媒体控制前台服务（P1.4b）+ 桌面歌词悬浮窗（P2.3）。
 *
 * 音频本体仍在 WebView 的 <audio> 里播放，本服务只负责：
 * - MediaSession（系统媒体面板 / 锁屏 / 蓝牙耳机按键）
 * - 前台服务 + MediaStyle 通知（封面、进度、播放控制、桌面歌词开关、点击回 App）
 * - 桌面歌词卡片（TYPE_APPLICATION_OVERLAY，可拖动；App 在前台时自动隐藏）
 *
 * 通知/媒体键/悬浮窗按钮的动作通过 {@link ActionListener} 回传给 Capacitor 插件，再由插件通知 JS。
 * 约定：value 对 seek 是毫秒；对 overlayToggled 是 1/0。
 */
public class MediaControlService extends Service {

    public static final String ACTION_UPDATE = "com.bilimusic.player.UPDATE";
    public static final String ACTION_PREV = "com.bilimusic.player.PREV";
    public static final String ACTION_TOGGLE = "com.bilimusic.player.TOGGLE";
    public static final String ACTION_NEXT = "com.bilimusic.player.NEXT";
    public static final String ACTION_TOGGLE_OVERLAY = "com.bilimusic.player.TOGGLE_OVERLAY";

    public interface ActionListener {
        void onAction(String action, long value);
    }

    private static ActionListener listener;
    private static MediaControlService instance;
    private static boolean running = false;
    private static boolean appVisible = false;

    public static void setListener(ActionListener l) {
        listener = l;
    }

    public static boolean isRunning() {
        return running;
    }

    /** App 可见性（前台时隐藏桌面歌词，退后台/锁屏自动显示） */
    public static void setAppVisible(boolean visible) {
        Log.i(TAG, "setAppVisible " + visible);
        appVisible = visible;
        MediaControlService s = instance;
        if (s != null) s.applyOverlayVisibility();
    }
    private static final String CHANNEL_ID = "bmp-playback";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS = "bmp-overlay";
    private static final String TAG = "BMP-Media";

    private MediaSessionCompat session;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private String lastArtworkUrl = "";
    private Bitmap artwork;
    private volatile long artworkRequestId = 0;

    private String title = "";
    private String artist = "";
    private String album = "";
    private boolean playing = false;
    private long positionMs = 0;
    private long durationMs = 0;

    private WindowManager windowManager;
    private LinearLayout overlayView;
    private TextView overlayLine;
    private TextView overlayRoma;
    private TextView overlayTrans;
    private ImageButton overlayPlay;
    private WindowManager.LayoutParams overlayParams;
    private boolean overlayEnabled = false;
    private String lyricText = "";
    private String lyricTrans = "";
    // 逐字（QRC）与罗马音（P8.4b）：lyricWords 为 JSON 字符串数组；sung 为当前词下标（-1 无）
    private String lyricRoma = "";
    private String lyricWords = "[]";
    private int lyricSung = -1;
    private double lyricProgress = 0d;
    // 通知栏显示的当前歌词行（2026-09-27；空则回退歌手）
    private String notifyLyric = "";

    // 迷你播放器悬浮窗（H2）：与桌面歌词互斥，显示歌名/歌手 + 控制按钮
    private LinearLayout miniView;
    private TextView miniTitleView;
    private TextView miniArtistView;
    private TextView miniLyricView;
    private ImageButton miniPlay;
    private WindowManager.LayoutParams miniParams;
    private boolean miniEnabled = false;
    private String miniTitle = "";
    private String miniArtist = "";
    private String miniLyric = "";
    private boolean miniPlaying = false;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "onCreate start");
        instance = this;
        running = true;
        createChannel();
        // 冷启动 / 重装后系统要求尽快进入前台（5s 内）：先用占位通知启动前台，
        // 避免 ForegroundServiceDidNotStartInTimeException 导致进程被杀
        startForegroundCompat();
        Log.i(TAG, "onCreate foreground ok");
        session = new MediaSessionCompat(this, "bmp");
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(
            new MediaSessionCompat.Callback() {
                @Override
                public void onPlay() {
                    dispatch("play", 0);
                }

                @Override
                public void onPause() {
                    dispatch("pause", 0);
                }

                @Override
                public void onStop() {
                    dispatch("pause", 0);
                }

                @Override
                public void onSkipToNext() {
                    dispatch("next", 0);
                }

                @Override
                public void onSkipToPrevious() {
                    dispatch("prev", 0);
                }

                @Override
                public void onSeekTo(long pos) {
                    // 先乐观更新会话位置与通知进度：系统面板点按后会立刻回读 PlaybackState，
                    // 若不在原生侧先更新（等 JS 往返），界面会先弹回旧位置再跳到目标。
                    positionMs = Math.max(0, pos);
                    updateSession();
                    updateNotification();
                    Log.i(TAG, "onSeekTo " + positionMs + " (optimistic session update)");
                    dispatch("seek", pos);
                }
            }
        );
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 先进入前台（幂等），再做动作分发与 extras 处理，避免慢路径导致 FGS 超时
        startForegroundCompat();
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PREV.equals(action)) {
            dispatch("prev", 0);
        } else if (ACTION_NEXT.equals(action)) {
            dispatch("next", 0);
        } else if (ACTION_TOGGLE.equals(action)) {
            dispatch(playing ? "pause" : "play", 0);
        } else if (ACTION_TOGGLE_OVERLAY.equals(action)) {
            Log.i(TAG, "notification toggle overlay, canDrawOverlays=" + Settings.canDrawOverlays(this));
            if (!Settings.canDrawOverlays(this)) {
                dispatch("overlayDenied", 0);
            } else {
                setOverlayEnabled(!overlayEnabled);
                dispatch("overlayToggled", overlayEnabled ? 1 : 0);
            }
        }

        if (intent != null) {
            if (intent.hasExtra("title")) title = safe(intent.getStringExtra("title"));
            if (intent.hasExtra("artist")) artist = safe(intent.getStringExtra("artist"));
            if (intent.hasExtra("album")) album = safe(intent.getStringExtra("album"));
            if (intent.hasExtra("playing")) playing = intent.getBooleanExtra("playing", playing);
            if (intent.hasExtra("position")) {
                positionMs = intent.getLongExtra("position", positionMs);
                Log.i(TAG, "update from JS pos=" + positionMs + " playing=" + playing);
            }
            if (intent.hasExtra("duration")) durationMs = intent.getLongExtra("duration", durationMs);
            if (intent.hasExtra("artwork")) loadArtwork(safe(intent.getStringExtra("artwork")));
            if (intent.hasExtra("overlayEnabled")) setOverlayEnabled(intent.getBooleanExtra("overlayEnabled", false));
            if (intent.hasExtra("lyricText")) {
                lyricText = safe(intent.getStringExtra("lyricText"));
                lyricTrans = safe(intent.getStringExtra("lyricTrans"));
                lyricRoma = safe(intent.getStringExtra("lyricRoma"));
                lyricWords = safe(intent.getStringExtra("lyricWords"));
                lyricSung = intent.getIntExtra("lyricSung", -1);
                lyricProgress = intent.getDoubleExtra("lyricProgress", 0d);
                updateOverlayText();
            }
            if (intent.hasExtra("mediaLyric")) {
                notifyLyric = safe(intent.getStringExtra("mediaLyric"));
            }
            if (intent.hasExtra("miniEnabled")) setMiniEnabled(intent.getBooleanExtra("miniEnabled", false));
            if (intent.hasExtra("miniTitle")) {
                miniTitle = safe(intent.getStringExtra("miniTitle"));
                updateMiniText();
            }
            if (intent.hasExtra("miniArtist")) {
                miniArtist = safe(intent.getStringExtra("miniArtist"));
                updateMiniText();
            }
            if (intent.hasExtra("miniLyric")) {
                miniLyric = safe(intent.getStringExtra("miniLyric"));
                updateMiniText();
            }
            if (intent.hasExtra("miniPlaying")) {
                miniPlaying = intent.getBooleanExtra("miniPlaying", miniPlaying);
                updateMiniControls();
            }
        }

        startForegroundCompat();
        updateSession();
        updateNotification();
        updateOverlayControls();
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        instance = null;
        hideOverlay();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        artworkRequestId++;
        if (artwork != null) {
            artwork.recycle();
            artwork = null;
        }

        artworkExecutor.shutdownNow();
        super.onDestroy();
    }

    // ── 会话 / 通知 ────────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("显示当前播放歌曲、进度与播放控制");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private void startForegroundCompat() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateSession() {
        if (session == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());

        long actions =
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_PLAY_PAUSE |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SEEK_TO |
            PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                    playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    positionMs,
                    playing ? 1f : 0f
                )
                .build()
        );
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.notify(NOTIFICATION_ID, buildNotification());
        // 桌面小组件（H3）跟随通知栏一起刷新
        MiniWidgetProvider.updateAll(this, title, artist, playing);
    }

    private Notification buildNotification() {
        String contentTitle = title.isEmpty() ? getString(R.string.app_name) : title;
        // 折叠态优先显示当前歌词行（无歌词时回退歌手）；展开时歌手放 subText
        String contentText = notifyLyric.isEmpty() ? artist : notifyLyric;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(contentTitle)
            .setContentText(contentText)
            .setContentIntent(contentIntent())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .addAction(R.drawable.ic_ov_prev, "上一首", serviceIntent(ACTION_PREV))
            .addAction(
                playing ? R.drawable.ic_ov_pause : R.drawable.ic_ov_play,
                playing ? "暂停" : "播放",
                serviceIntent(ACTION_TOGGLE)
            )
            .addAction(R.drawable.ic_ov_next, "下一首", serviceIntent(ACTION_NEXT))
            .addAction(
                overlayEnabled ? R.drawable.ic_stat_lyrics_on : R.drawable.ic_stat_lyrics_off,
                "桌面歌词",
                serviceIntent(ACTION_TOGGLE_OVERLAY)
            )
            .setStyle(
                new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session != null ? session.getSessionToken() : null)
                    .setShowActionsInCompactView(0, 1, 2)
            );
        if (artwork != null) b.setLargeIcon(artwork);
        if (!notifyLyric.isEmpty() && !artist.isEmpty()) b.setSubText(artist);
        if (durationMs > 0) {
            int permille = (int) Math.max(0, Math.min(1000, positionMs * 1000 / durationMs));
            b.setProgress(1000, permille, false);
        }
        return b.build();
    }

    private PendingIntent contentIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        return PendingIntent.getActivity(this, 0, intent, pendingFlags());
    }

    private PendingIntent serviceIntent(String action) {
        Intent intent = new Intent(this, MediaControlService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent, pendingFlags());
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private void loadArtwork(String url) {
        if (url.isEmpty() || url.equals(lastArtworkUrl)) return;
        final long requestId = ++artworkRequestId;
        lastArtworkUrl = url;
        artworkExecutor.execute(
            () -> {
                Bitmap bmp = null;
                try {
                    URL u = new URL(url);
                    HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                    String host = u.getHost();
                    if (host.endsWith("qq.com") || host.endsWith("gtimg.cn") || host.endsWith("qlogo.cn")) {
                        conn.setRequestProperty("Referer", "https://y.qq.com/");
                    } else {
                        conn.setRequestProperty("Referer", "https://www.bilibili.com/");
                    }
                    InputStream in = conn.getInputStream();
                    bmp = BitmapFactory.decodeStream(in);
                    in.close();
                } catch (Exception ignored) {
                    /* 封面加载失败不影响通知 */
                }
                if (bmp != null) {
                    final Bitmap result = bmp;
                    new Handler(Looper.getMainLooper()).post(
                        () -> {
                            if (requestId != artworkRequestId || !running || instance != this) {
                                result.recycle();
                                return;
                            }
                            if (artwork != null && artwork != result) artwork.recycle();
                            artwork = result;
                            updateSession();
                            updateNotification();
                        }
                    );
                }
            }
        );
    }
    // ── 桌面歌词卡片 ──────────────────────────────────────────────────────

    private void setOverlayEnabled(boolean enabled) {
        overlayEnabled = enabled;
        applyOverlayVisibility();
        updateNotification();
    }

    /** App 可见时隐藏悬浮窗（避免遮挡 App 内歌词页）；退后台/锁屏自动显示 */
    private void applyOverlayVisibility() {
        Log.i(TAG, "applyOverlayVisibility enabled=" + overlayEnabled + " appVisible=" + appVisible);
        if (overlayEnabled && !appVisible) showOverlay();
        else hideOverlay();
        applyMiniVisibility();
    }

    private void showOverlay() {
        if (overlayView != null) return;
        final boolean meizu = "meizu".equalsIgnoreCase(Build.MANUFACTURER) || "meizu".equalsIgnoreCase(Build.BRAND);
        if (!Settings.canDrawOverlays(this)) return;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (windowManager == null) return;

        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int cardWidth = Math.max(dp(220), screenWidth - dp(48));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xD9121218);
        bg.setCornerRadius(dp(16));
        card.setBackground(bg);
        card.setPadding(dp(16), dp(10), dp(16), dp(6));
        card.setElevation(dp(8));

        overlayLine = new TextView(this);
        overlayLine.setTextColor(0xFF31C27C);
        overlayLine.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        overlayLine.setTypeface(null, Typeface.BOLD);
        overlayLine.setGravity(Gravity.CENTER);
        overlayLine.setMaxLines(2);
        overlayLine.setEllipsize(TextUtils.TruncateAt.END);

        overlayRoma = new TextView(this);
        overlayRoma.setTextColor(0xB3FFFFFF);
        overlayRoma.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        overlayRoma.setGravity(Gravity.CENTER);
        overlayRoma.setMaxLines(1);
        overlayRoma.setEllipsize(TextUtils.TruncateAt.END);

        overlayTrans = new TextView(this);
        overlayTrans.setTextColor(0xE6FFFFFF);
        overlayTrans.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        overlayTrans.setGravity(Gravity.CENTER);
        overlayTrans.setMaxLines(2);
        overlayTrans.setEllipsize(TextUtils.TruncateAt.END);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(4), 0, 0);
        controls.addView(
            overlayButton(R.drawable.ic_ov_prev, "上一首", v -> dispatch("prev", 0))
        );
        overlayPlay = overlayButton(R.drawable.ic_ov_play, "播放/暂停", v -> dispatch(playing ? "pause" : "play", 0));
        controls.addView(overlayPlay);
        controls.addView(
            overlayButton(R.drawable.ic_ov_next, "下一首", v -> dispatch("next", 0))
        );
        controls.addView(
            overlayButton(
                R.drawable.ic_ov_close,
                "关闭桌面歌词",
                v -> {
                    setOverlayEnabled(false);
                    dispatch("overlayClosed", 0);
                }
            )
        );

        card.addView(overlayLine);
        card.addView(overlayRoma);
        card.addView(overlayTrans);
        card.addView(controls);

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        overlayParams = new WindowManager.LayoutParams(
            cardWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                (meizu ? WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE : 0),
            PixelFormat.TRANSLUCENT
        );
        overlayParams.gravity = Gravity.TOP | Gravity.START;
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        overlayParams.x = sp.getInt("x", dp(24));
        overlayParams.y = sp.getInt("y", dp(160));

        // 拖动只挂在上方歌词区（挂整张卡片会在 DOWN 时消费事件，按钮就点不到了）
        attachDrag(overlayLine, overlayParams, "");
        attachDrag(overlayRoma, overlayParams, "");
        attachDrag(overlayTrans, overlayParams, "");

        try {
            windowManager.addView(card, overlayParams);
            overlayView = card;
            Log.i(TAG, "overlay shown " + cardWidth + "x wrap @" + overlayParams.x + "," + overlayParams.y);
        } catch (Exception e) {
            overlayView = null;
            Log.w(TAG, "overlay addView failed: " + e);
            return;
        }
        updateOverlayText();
        updateOverlayControls();
    }

    /** 拖动歌词区移动悬浮窗（按钮不参与拖动）；prefix 区分桌面歌词（空）与迷你播放器（mini） */
    private void attachDrag(View target, WindowManager.LayoutParams params, String prefix) {
        target.setOnTouchListener(
            new View.OnTouchListener() {
                float downX;
                float downY;
                int startX;
                int startY;
                boolean moved;

                @Override
                public boolean onTouch(View v, MotionEvent e) {
                    switch (e.getActionMasked()) {
                        case MotionEvent.ACTION_DOWN:
                            downX = e.getRawX();
                            downY = e.getRawY();
                            startX = params.x;
                            startY = params.y;
                            moved = false;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            int dx = (int) (e.getRawX() - downX);
                            int dy = (int) (e.getRawY() - downY);
                            if (Math.abs(dx) > dp(4) || Math.abs(dy) > dp(4)) moved = true;
                            params.x = startX + dx;
                            params.y = startY + dy;
                            View host = prefix.isEmpty() ? overlayView : miniView;
                            try {
                                if (host != null) windowManager.updateViewLayout(host, params);
                            } catch (Exception ignored) {
                                /* ignore */
                            }
                            return true;
                        case MotionEvent.ACTION_UP:
                        case MotionEvent.ACTION_CANCEL:
                            if (moved) {
                                getSharedPreferences(PREFS, MODE_PRIVATE)
                                    .edit()
                                    .putInt(prefix + "x", params.x)
                                    .putInt(prefix + "y", params.y)
                                    .apply();
                                Log.i(TAG, "overlay moved(" + prefix + ") to " + params.x + "," + params.y);
                            }
                            return true;
                        default:
                            return false;
                    }
                }
            }
        );
    }

    private ImageButton overlayButton(int iconRes, String desc, View.OnClickListener l) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(iconRes);
        b.setBackgroundResource(android.R.color.transparent);
        b.setContentDescription(desc);
        b.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(40));
        lp.setMargins(dp(8), 0, dp(8), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private void hideOverlay() {
        if (overlayView != null && windowManager != null) {
            try {
                windowManager.removeView(overlayView);
                Log.i(TAG, "overlay hidden");
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        overlayView = null;
    }

    private void updateOverlayText() {
        if (overlayLine == null) return;
        if (lyricText.isEmpty()) {
            overlayLine.setText("♪");
        } else {
            String[] words = parseLyricWords(lyricWords);
            if (words.length > 1 && lyricSung >= 0) {
                overlayLine.setText(buildKaraokeText(words));
            } else {
                overlayLine.setText(lyricText);
            }
        }
        if (lyricRoma.isEmpty()) {
            overlayRoma.setVisibility(View.GONE);
        } else {
            overlayRoma.setVisibility(View.VISIBLE);
            overlayRoma.setText(lyricRoma);
        }
        if (lyricTrans.isEmpty()) {
            overlayTrans.setVisibility(View.GONE);
        } else {
            overlayTrans.setVisibility(View.VISIBLE);
            overlayTrans.setText(lyricTrans);
        }
    }

    /** lyricWords JSON 字符串数组 → String[]（解析失败返回空数组） */
    private String[] parseLyricWords(String json) {
        if (json == null || json.isEmpty()) return new String[0];
        try {
            JSONArray arr = new JSONArray(json);
            String[] out = new String[arr.length()];
            for (int i = 0; i < arr.length(); i++) out[i] = arr.optString(i, "");
            return out;
        } catch (Exception e) {
            return new String[0];
        }
    }

    /**
     * 逐字着色（词级）：已唱=品牌绿；当前词=品牌绿→浅绿（按进度，不混白，
     * 唱完回到品牌绿时无跳色）；未唱=半透明白。
     */
    private CharSequence buildKaraokeText(String[] words) {
        SpannableStringBuilder sb = new SpannableStringBuilder();
        for (int i = 0; i < words.length; i++) {
            int start = sb.length();
            sb.append(words[i] == null ? "" : words[i]);
            int color;
            if (i < lyricSung) {
                color = 0xFF31C27C;
            } else if (i == lyricSung) {
                color = blendColor(0xFF31C27C, 0xFF9BE8C4, lyricProgress);
            } else {
                color = 0x99FFFFFF;
            }
            sb.setSpan(new ForegroundColorSpan(color), start, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return sb;
    }

    /** 线性混合两个 ARGB 颜色（t=0 取 from，t=1 取 to） */
    private int blendColor(int from, int to, double t) {
        double k = Math.min(Math.max(t, 0d), 1d);
        int a = (int) Math.round(((from >>> 24) & 0xFF) + (((to >>> 24) & 0xFF) - ((from >>> 24) & 0xFF)) * k);
        int r = (int) Math.round(((from >> 16) & 0xFF) + (((to >> 16) & 0xFF) - ((from >> 16) & 0xFF)) * k);
        int g = (int) Math.round(((from >> 8) & 0xFF) + (((to >> 8) & 0xFF) - ((from >> 8) & 0xFF)) * k);
        int b = (int) Math.round((from & 0xFF) + ((to & 0xFF) - (from & 0xFF)) * k);
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    private void updateOverlayControls() {
        if (overlayPlay == null) return;
        overlayPlay.setImageResource(playing ? R.drawable.ic_ov_pause : R.drawable.ic_ov_play);
    }

    // ── 迷你播放器卡片（H2） ───────────────────────────────────────────────

    private void setMiniEnabled(boolean enabled) {
        miniEnabled = enabled;
        // 两种悬浮窗互斥，避免叠在一起
        if (enabled) setOverlayEnabled(false);
        applyMiniVisibility();
    }

    private void applyMiniVisibility() {
        Log.i(TAG, "applyMiniVisibility enabled=" + miniEnabled + " appVisible=" + appVisible);
        if (miniEnabled && !appVisible) showMini();
        else hideMini();
    }

    private void showMini() {
        if (miniView != null) return;
        final boolean meizu = "meizu".equalsIgnoreCase(Build.MANUFACTURER) || "meizu".equalsIgnoreCase(Build.BRAND);
        if (!Settings.canDrawOverlays(this)) return;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (windowManager == null) return;

        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int cardWidth = Math.min(dp(380), Math.max(dp(280), screenWidth - dp(24)));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xD9121218);
        bg.setCornerRadius(dp(14));
        card.setBackground(bg);
        card.setPadding(dp(14), dp(8), dp(6), dp(8));
        card.setElevation(dp(8));

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        texts.setPadding(dp(2), 0, dp(8), 0);
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        miniTitleView = new TextView(this);
        miniTitleView.setTextColor(0xFF31C27C);
        miniTitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        miniTitleView.setTypeface(null, Typeface.BOLD);
        miniTitleView.setMaxLines(1);
        miniTitleView.setEllipsize(TextUtils.TruncateAt.END);

        miniArtistView = new TextView(this);
        miniArtistView.setTextColor(0xB3FFFFFF);
        miniArtistView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        miniArtistView.setMaxLines(1);
        miniArtistView.setEllipsize(TextUtils.TruncateAt.END);

        miniLyricView = new TextView(this);
        miniLyricView.setTextColor(0x99FFFFFF);
        miniLyricView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        miniLyricView.setMaxLines(1);
        miniLyricView.setEllipsize(TextUtils.TruncateAt.END);
        miniLyricView.setVisibility(View.GONE);

        texts.addView(miniTitleView);
        texts.addView(miniArtistView);
        texts.addView(miniLyricView);

        miniPlay = overlayButton(R.drawable.ic_ov_play, "播放/暂停", v -> dispatch("miniToggle", 0));
        card.addView(texts);
        card.addView(overlayButton(R.drawable.ic_ov_prev, "上一首", v -> dispatch("miniPrev", 0)));
        card.addView(miniPlay);
        card.addView(overlayButton(R.drawable.ic_ov_next, "下一首", v -> dispatch("miniNext", 0)));
        card.addView(
            overlayButton(
                R.drawable.ic_ov_close,
                "关闭迷你播放器",
                v -> {
                    setMiniEnabled(false);
                    dispatch("miniClosed", 0);
                }
            )
        );

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        miniParams = new WindowManager.LayoutParams(
            cardWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                (meizu ? WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE : 0),
            PixelFormat.TRANSLUCENT
        );
        miniParams.gravity = Gravity.TOP | Gravity.START;
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        miniParams.x = sp.getInt("miniX", dp(16));
        miniParams.y = sp.getInt("miniY", dp(140));

        attachDrag(texts, miniParams, "mini");

        try {
            windowManager.addView(card, miniParams);
            miniView = card;
            Log.i(TAG, "mini shown " + cardWidth + " @" + miniParams.x + "," + miniParams.y);
        } catch (Exception e) {
            miniView = null;
            Log.w(TAG, "mini addView failed: " + e);
            return;
        }
        updateMiniText();
        updateMiniControls();
    }
    private void hideMini() {
        if (miniView != null && windowManager != null) {
            try {
                windowManager.removeView(miniView);
                Log.i(TAG, "mini hidden");
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        miniView = null;
    }

    private void updateMiniText() {
        if (miniTitleView == null) return;
        miniTitleView.setText(miniTitle.isEmpty() ? "♪ 未在播放" : miniTitle);
        miniArtistView.setText(miniArtist);
        if (miniLyricView != null) {
            if (miniLyric.isEmpty()) {
                miniLyricView.setVisibility(View.GONE);
            } else {
                miniLyricView.setVisibility(View.VISIBLE);
                miniLyricView.setText(miniLyric);
            }
        }
    }

    private void updateMiniControls() {
        if (miniPlay == null) return;
        miniPlay.setImageResource(miniPlaying ? R.drawable.ic_ov_pause : R.drawable.ic_ov_play);
    }

    // ── 工具 ──────────────────────────────────────────────────────────────

    private void dispatch(String action, long value) {
        Log.i(TAG, "dispatch " + action + " " + value);
        ActionListener l = listener;
        if (l != null) l.onAction(action, value);
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
