package app.codeg.web;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class WebBootstrapScriptTest {
    @Test
    public void escapesTokenBeforeWritingLocalStorage() {
        String script = WebBootstrapScript.create(
                "quote\" newline\n </script>",
                "https://codeg.example/workspace");

        assertTrue(script.contains("localStorage.setItem"));
        assertTrue(script.contains("quote\\\" newline\\n \\u003c/script\\u003e"));
        assertFalse(script.contains("</script>"));
    }

    @Test
    public void wakeScriptUsesEventsAlreadyHandledByWebTransport() {
        String script = WebBootstrapScript.wake();

        assertTrue(script.contains("online"));
        assertTrue(script.contains("visibilitychange"));
    }

    @Test
    public void androidSafeAreaOnlyOffsetsTheMobileSidebar() {
        String script = WebBootstrapScript.setAndroidStatusBarInset(27);

        assertTrue(script.contains("mobile-sidebar-drawer"));
        assertTrue(script.contains("27px"));
        assertFalse(script.contains("body{"));
    }

    @Test
    public void androidAppWindowsNavigateTheCurrentWebView() {
        String script = WebBootstrapScript.setAndroidStatusBarInset(24);

        assertTrue(script.contains("window.open=function"));
        assertTrue(script.contains("window.location.assign"));
        assertTrue(script.contains("about:blank"));
        assertTrue(script.contains("originalOpen.call"));
    }
}
