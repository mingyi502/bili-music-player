package com.bilimusic.player;

import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 网页登录插件（仅 Android）。
 *
 * JS 侧调用 open({ url }) 打开内嵌 QQ 登录页，用户在真实页面上完成登录后，
 * 插件把登录后的 Cookie 回传；clear() 用于退出登录时清掉浏览器会话。
 */
@CapacitorPlugin(name = "QqWebLogin")
public class QqWebLoginPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少登录页地址");
            return;
        }
        Intent intent = new Intent(getContext(), QqLoginActivity.class);
        intent.putExtra(QqLoginActivity.EXTRA_START_URL, url);
        // 实验开关：允许用户点「一键登录」尝试拉起手机 QQ（此时不自动返回）
        intent.putExtra(QqLoginActivity.EXTRA_ALLOW_ONE_KEY, Boolean.TRUE.equals(call.getBoolean("allowOneKey", false)));
        String ua = call.getString("userAgent");
        if (ua != null) intent.putExtra(QqLoginActivity.EXTRA_USER_AGENT, ua);
        startActivityForResult(call, intent, "onLoginResult");
    }

    /** 登录页返回：成功时把 Cookie 交给 JS */
    @ActivityCallback
    private void onLoginResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("已取消登录");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("cookie", data.getStringExtra(QqLoginActivity.EXTRA_COOKIE));
        ret.put("url", data.getStringExtra(QqLoginActivity.EXTRA_URL));
        ret.put("hasMusicKey", data.getBooleanExtra(QqLoginActivity.EXTRA_HAS_KEY, false));
        ret.put("cookieNames", data.getStringExtra(QqLoginActivity.EXTRA_COOKIE_NAMES));
        ret.put("navLog", data.getStringExtra(QqLoginActivity.EXTRA_NAV_LOG));
        ret.put("jumpUrl", data.getStringExtra(QqLoginActivity.EXTRA_JUMP_URL));
        call.resolve(ret);
    }

    /** 退出登录时清空 WebView 的浏览器 Cookie，避免下次登录直接是上一个账号 */
    @PluginMethod
    public void clear(PluginCall call) {
        CookieManager.getInstance().removeAllCookies(ignored -> call.resolve());
    }
}
