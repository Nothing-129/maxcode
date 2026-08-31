package app.codeg.web;

final class WebBootstrapScript {
    private static final String TOKEN_KEY = "codeg_token";

    private WebBootstrapScript() {}

    static String create(String token, String workspaceUrl) {
        return "(function(){localStorage.setItem("
                + JavaScriptEscaper.quote(TOKEN_KEY)
                + ","
                + JavaScriptEscaper.quote(token)
                + ");window.location.replace("
                + JavaScriptEscaper.quote(workspaceUrl)
                + ");})();";
    }

    static String wake() {
        return "(function(){window.dispatchEvent(new Event('online'));"
                + "document.dispatchEvent(new Event('visibilitychange'));})();";
    }

    static String setAndroidStatusBarInset(
            int insetCssPixels,
            boolean protectPageShells) {
        int safeInset = Math.max(0, insetCssPixels);
        String pageSafeAreaCss = protectPageShells
                ? "div.fixed.inset-0.flex.flex-col.overflow-hidden.bg-background.text-foreground,"
                        + "div.h-screen.flex.flex-col.overflow-hidden.bg-background."
                        + "text-foreground{box-sizing:border-box;"
                        + "padding-top:var(--maxcode-android-status-bar-inset)!important;}"
                : "";
        return "(function(){var d=document.documentElement;"
                + "d.style.setProperty('--maxcode-android-status-bar-inset','"
                + safeInset
                + "px');var i='maxcode-android-safe-area';"
                + "var s=document.getElementById(i);if(!s){s=document.createElement('style');"
                + "s.id=i;(document.head||d).appendChild(s);}"
                + "s.textContent='@media (max-width:767px){.mobile-sidebar-drawer{"
                + "padding-top:var(--maxcode-android-status-bar-inset)!important;}}"
                + pageSafeAreaCss
                + "';"
                + "if(!window.__maxcodeAndroidWindowOpenPatched){"
                + "window.__maxcodeAndroidWindowOpenPatched=true;"
                + "var originalOpen=window.open;window.open=function(url,name,features){"
                + "if((url===''||url==null)&&!features){var href='about:blank';"
                + "return{location:{get href(){return href;},set href(value){"
                + "href=String(value);window.location.assign(href);}},"
                + "close:function(){},closed:false};}"
                + "return originalOpen.call(window,url,name,features);};}})();";
    }
}
