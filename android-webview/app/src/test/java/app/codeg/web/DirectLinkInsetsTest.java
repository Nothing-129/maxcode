package app.codeg.web;

import static org.junit.Assert.assertEquals;

import android.graphics.Insets;
import android.view.View;
import android.view.WindowInsets;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ActivityController;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class DirectLinkInsetsTest {
    @Test
    public void directLinksReserveNativeStatusBarAndKeyboardSpace() throws Exception {
        // Reflective factory avoids Robolectric's reference to the SDK-hidden
        // android.annotation.RequiresApi under javac -Xlint:all -Werror.
        try (ActivityController<?> controller = (ActivityController<?>)
                Class.forName("org.robolectric.Robolectric")
                        .getMethod("buildActivity", Class.class)
                        .invoke(null, MainActivity.class)) {
            controller.setup();
            MainActivity activity = (MainActivity) controller.get();
            View root = activity.findViewById(R.id.root);
            java.lang.reflect.Method start = MainActivity.class.getDeclaredMethod(
                    "startBrowser", ConnectionConfig.class);
            start.setAccessible(true);
            WindowInsets insets = new WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.statusBars(), Insets.of(0, 80, 0, 0))
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.of(0, 100, 0, 0))
                    .setInsets(WindowInsets.Type.navigationBars(), Insets.of(0, 0, 0, 40))
                    .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 300))
                    .build();
            // Switching from immersive MaxCode must restore native top padding.
            start.invoke(activity, new ConnectionConfig("https://example.com", "token"));
            root.dispatchApplyWindowInsets(insets);
            assertEquals(0, root.getPaddingTop());
            for (ConnectionConfig connection : new ConnectionConfig[] {
                    new ConnectionConfig("https://example.com/remote/v4?sid=test", ""),
                    new ConnectionConfig("https://example.com/remote/v4?sid=test", "token"),
                    new ConnectionConfig("https://example.com", "")}) {
                start.invoke(activity, connection);
                root.dispatchApplyWindowInsets(insets);
                assertEquals(100, root.getPaddingTop());
                assertEquals(300, root.getPaddingBottom());
            }
        }
    }
}
