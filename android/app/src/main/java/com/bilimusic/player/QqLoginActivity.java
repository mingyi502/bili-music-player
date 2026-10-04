package com.bilimusic.player;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 内嵌「QQ 登录页」。
 *
 * 用户在腾讯官方页面上用任意方式登录（扫码 / 密码 / 验证码 / 微信），
 * 本 Activity 不做登录逻辑，只负责：
 *   1. 提供可正常交互的 WebView（含弹窗处理）
 *   2. 检测登录完成的标志（Cookie 里出现 qm_keyst / qqmusic_key）
 *   3. 把登录后的 Cookie 回传给 Capacitor 插件
 *
 * ⚠️ 实测：登录过程中腾讯把 Cookie 写在 **.ptlogin2.qq.com** 域下（qrsig / pt_login_sig / uikey…），
 * 而音乐票据在 y.qq.com/.qq.com 下。只读 y.qq.com 会漏掉登录态，因此这里按多域名合并读取。
 */
public class QqLoginActivity extends Activity {

    public static final String EXTRA_START_URL = "startUrl";
    public static final String EXTRA_USER_AGENT = "userAgent";
    public static final String EXTRA_ALLOW_ONE_KEY = "allowOneKey";
    public static final String EXTRA_COOKIE = "cookie";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_HAS_KEY = "hasMusicKey";
    public static final String EXTRA_COOKIE_NAMES = "cookieNames";
    public static final String EXTRA_NAV_LOG = "navLog";
    public static final String EXTRA_JUMP_URL = "jumpUrl";

    /** 合并读取 Cookie 的域名（顺序即优先级，前面的先赢） */
    private static final String[] COOKIE_URLS = {
        "https://y.qq.com/",
        "https://c.y.qq.com/",
        "https://u.y.qq.com/",
        "https://graph.qq.com/",
        "https://qun.qq.com/",
        "https://ptlogin2.qq.com/",
        "https://xui.ptlogin2.qq.com/",
        "https://ui.ptlogin2.qq.com/",
    };

    /** 登录成功的标志：QQ 音乐会话票据 */
    private static final String[] KEY_MARKERS = { "qm_keyst=", "qqmusic_key=" };
    private static final int MAX_POLLS = 40;
    private static final long POLL_INTERVAL_MS = 500;
    private static final int MAX_NAV_LOG = 30;

    /**
     * 移动端登录页默认展示「快捷登录（二维码）」，不再自动切到密码表单。
     *
     * 历史：早期为避免单机用户扫自己屏幕的尴尬，加载后会自动点「使用账号密码登录」，
     * 但这会把二维码区藏起来，被用户反馈为体验问题（2026-09-26）。
     * 现在保持腾讯页面原样，需要密码登录时用户点页面顶部标签自行切换。
     */

    private WebView webView;
    private LinearLayout root;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<String> navLog = new ArrayList<>();
    private String jumpUrl = "";
    private String lastUrl = "";
    private boolean allowOneKey = false;
    private boolean done = false;
    private int polls = 0;

    private final Runnable cookieCheck = new Runnable() {
        @Override
        public void run() {
            if (done) return;
            if (isLoginComplete()) {
                finishWithCookie();
                return;
            }
            if (polls++ < MAX_POLLS) handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#101014"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#1e1e22"));
        int pad = dp(12);
        bar.setPadding(pad, dp(8), dp(8), dp(8));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView title = new TextView(this);
        title.setText("登录 QQ 音乐");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16f);

        TextView hint = new TextView(this);
        hint.setText("在下方腾讯页面完成登录（支持扫码/密码/验证码），成功后会自动返回");
        hint.setTextColor(Color.parseColor("#9aa0a6"));
        hint.setTextSize(11f);

        titles.addView(title);
        titles.addView(hint);

        Button doneBtn = new Button(this);
        doneBtn.setText("我已完成登录");
        doneBtn.setOnClickListener(v -> finishWithCookie());

        Button closeBtn = new Button(this);
        closeBtn.setText("关闭");
        closeBtn.setOnClickListener(v -> cancelLogin());

        bar.addView(titles);
        bar.addView(doneBtn);
        bar.addView(closeBtn);
        root.addView(bar);

        webView = new WebView(this);
        setupWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        allowOneKey = getIntent().getBooleanExtra(EXTRA_ALLOW_ONE_KEY, false);
        if (allowOneKey) {
            TextView extra = new TextView(this);
            extra.setText("实验模式：点「一键登录」会尝试拉起手机 QQ；完成后点右上角「我已完成登录」");
            extra.setTextColor(Color.parseColor("#f0b429"));
            extra.setTextSize(11f);
            extra.setPadding(pad, dp(6), pad, dp(6));
            root.addView(extra, 1);
        }

        String startUrl = getIntent().getStringExtra(EXTRA_START_URL);
        if (startUrl == null || startUrl.isEmpty()) {
            startUrl = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin";
        }
        lastUrl = startUrl;
        recordNav(startUrl);
        webView.loadUrl(startUrl);
    }

    private void setupWebView(final WebView view) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        String ua = getIntent().getStringExtra(EXTRA_USER_AGENT);
        if (ua != null && !ua.isEmpty()) s.setUserAgentString(ua);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(view, true);

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                String u = request.getUrl().toString();
                // 非 http(s)（如 mqqapi:// intent://）交回系统处理，避免静默失败卡住
                if (!u.startsWith("http://") && !u.startsWith("https://")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (Exception ignored) {
                        // 没有应用能处理就忽略，继续留在当前页
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                lastUrl = url;
                recordNav(url);
                scheduleCookieCheck();
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView parent, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                final WebView tmp = new WebView(QqLoginActivity.this);
                tmp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        if (webView != null) webView.loadUrl(request.getUrl().toString());
                        destroyTemp(tmp);
                        return true;
                    }

                    @Override
                    @SuppressWarnings("deprecation")
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        if (webView != null) webView.loadUrl(url);
                        destroyTemp(tmp);
                        return true;
                    }
                });
                root.addView(tmp, new LinearLayout.LayoutParams(0, 0));
                if (resultMsg.obj instanceof WebView.WebViewTransport) {
                    ((WebView.WebViewTransport) resultMsg.obj).setWebView(tmp);
                    resultMsg.sendToTarget();
                    return true;
                }
                destroyTemp(tmp);
                return false;
            }
        });
    }

    private void destroyTemp(WebView tmp) {
        try {
            ViewGroup parent = (ViewGroup) tmp.getParent();
            if (parent != null) parent.removeView(tmp);
            tmp.destroy();
        } catch (Exception ignored) {
            // 清理失败不影响主流程
        }
    }

    /** 记录浏览轨迹，并挑出「登录跳板」URL（check_sig / authorize / wx_redirect）备查 */
    private void recordNav(String url) {
        if (url == null) return;
        if (navLog.isEmpty() || !navLog.get(navLog.size() - 1).equals(url)) {
            navLog.add(url);
            while (navLog.size() > MAX_NAV_LOG) navLog.remove(0);
        }
        if (jumpUrl.isEmpty() && (url.contains("check_sig") || url.contains("/oauth2.0/authorize") || url.contains("wx_redirect"))) {
            jumpUrl = url;
        }
        android.util.Log.i("QqWebLogin", "nav: " + url);
    }

    private void scheduleCookieCheck() {
        polls = 0;
        handler.removeCallbacks(cookieCheck);
        handler.postDelayed(cookieCheck, 800);
    }

    /** 按多域名合并读取 Cookie（前面的域名优先） */
    private Map<String, String> collectCookies() {
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        Map<String, String> merged = new LinkedHashMap<>();
        for (String u : COOKIE_URLS) {
            String c = cm.getCookie(u);
            if (c == null || c.isEmpty()) continue;
            for (String part : c.split(";")) {
                String p = part.trim();
                if (p.isEmpty()) continue;
                int i = p.indexOf('=');
                if (i <= 0) continue;
                String name = p.substring(0, i).trim();
                if (name.isEmpty() || merged.containsKey(name)) continue;
                merged.put(name, p.substring(i + 1).trim());
            }
        }
        return merged;
    }

    private static String joinCookies(Map<String, String> jar) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : jar.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    private boolean hasMusicKey() {
        Map<String, String> jar = collectCookies();
        if (jar.containsKey("qm_keyst") || jar.containsKey("qqmusic_key")) return true;
        String joined = ";" + joinCookies(jar);
        for (String marker : KEY_MARKERS) {
            if (joined.contains(";" + marker)) return true;
        }
        return false;
    }

    /**
     * 登录是否已完成。
     *
     * 注意：WebView 里**不会**出现 qm_keyst —— 音乐票据由 JS 侧拿 Cookie 自己兑换
     * （QQ 的授权页要求「一键登录（拉起手机 QQ）」，在 WebView 里走不通）。
     * 因此这里以「腾讯下发了 p_skey（登录会话凭据）」作为完成标志，随后交给 JS 补完兑换。
     */
    private boolean isLoginComplete() {
        if (hasMusicKey()) return true;
        // 实验模式：允许用户在腾讯授权页点「一键登录」，因此不在检测到 p_skey 时自动返回
        if (allowOneKey) return false;
        Map<String, String> jar = collectCookies();
        if (jar.containsKey("p_skey")) return true;
        // 兼容：部分账号只下发 skey/superkey
        return jar.containsKey("skey") || jar.containsKey("superkey");
    }

    private void finishWithCookie() {
        if (done) return;
        done = true;
        handler.removeCallbacks(cookieCheck);

        Map<String, String> jar = collectCookies();
        String cookie = joinCookies(jar);
        boolean hasKey = jar.containsKey("qm_keyst") || jar.containsKey("qqmusic_key");
        android.util.Log.i("QqWebLogin", "finish: cookieLen=" + cookie.length() + " names=" + jar.keySet() + " hasKey=" + hasKey + " lastUrl=" + lastUrl);

        Intent data = new Intent();
        data.putExtra(EXTRA_COOKIE, cookie);
        data.putExtra(EXTRA_URL, lastUrl);
        data.putExtra(EXTRA_HAS_KEY, hasKey);
        data.putExtra(EXTRA_COOKIE_NAMES, String.join(",", jar.keySet()));
        data.putExtra(EXTRA_NAV_LOG, String.join("\n", navLog));
        data.putExtra(EXTRA_JUMP_URL, jumpUrl);
        setResult(RESULT_OK, data);
        finish();
    }

    private void cancelLogin() {
        if (done) return;
        done = true;
        handler.removeCallbacks(cookieCheck);
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            cancelLogin();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.destroy();
            } catch (Exception ignored) {
                // ignore
            }
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return (int) (getResources().getDisplayMetrics().density * value);
    }
}
