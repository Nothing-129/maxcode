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
    public void defaultAndroidTopSafeAreaOnlyOffsetsTheMobileSidebar() {
        String script = WebBootstrapScript.setAndroidStatusBarInset(27, false);

        assertTrue(script.contains("mobile-sidebar-drawer"));
        assertTrue(script.contains("padding-bottom:0!important;}"));
        assertFalse(script.contains("padding-bottom:0!important;padding-top:"));
        assertTrue(script.contains("27px"));
        assertFalse(script.contains("body{"));
    }

    @Test
    public void oppoSafeAreaAlsoOffsetsFullPageShells() {
        String script = WebBootstrapScript.setAndroidStatusBarInset(27, true);

        assertTrue(script.contains("div.fixed.inset-0"));
        assertTrue(script.contains("div.h-screen"));
        assertTrue(script.contains("box-sizing:border-box"));
    }

    @Test
    public void nativeBottomSafeAreaIsNotRepeatedByEitherPageShell() {
        for (boolean protectPageShells : new boolean[] {false, true}) {
            // Keyboard height never enters CSS: native layout owns both the
            // open-keyboard and closed-keyboard bottom inset.
            String script = WebBootstrapScript.setAndroidStatusBarInset(27, protectPageShells);

            assertTrue(script.contains(
                    "div.fixed.inset-0.flex.flex-col.overflow-hidden.bg-background.text-foreground,"
                            + "div.h-screen.flex.flex-col.overflow-hidden.bg-background.text-foreground"
                            + "{box-sizing:border-box;padding-bottom:0!important;"));
            assertFalse(script.contains("padding-bottom:env("));
        }
    }

    @Test
    public void androidAppWindowsNavigateTheCurrentWebView() {
        String script = WebBootstrapScript.setAndroidStatusBarInset(24, false);

        assertTrue(script.contains("window.open=function"));
        assertTrue(script.contains("window.location.assign"));
        assertTrue(script.contains("about:blank"));
        assertTrue(script.contains("originalOpen.call"));
    }
}
