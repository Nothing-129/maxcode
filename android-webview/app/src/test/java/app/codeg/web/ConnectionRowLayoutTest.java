package app.codeg.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, qualifiers = "mdpi")
public class ConnectionRowLayoutTest {
    @Test
    public void centersDeviceTextAndMenuOnTheSameRow() {
        assertRowAlignment("Mac Mini", 1f);
    }

    @Test
    public void keepsLongNamesAndLargerTextCenteredWithoutClipping() {
        assertRowAlignment("My development workstation with a longer name", 1.5f);
    }

    private void assertRowAlignment(String name, float fontScale) {
        Context app = RuntimeEnvironment.getApplication();
        Configuration config = new Configuration(app.getResources().getConfiguration());
        config.fontScale = fontScale;
        Context context = app.createConfigurationContext(config);
        context.setTheme(R.style.Theme_CodegWeb);
        ViewGroup screen = (ViewGroup) LayoutInflater.from(context)
                .inflate(R.layout.activity_main, null, false);
        ViewGroup list = screen.findViewById(R.id.saved_connections_list);
        ViewGroup row = (ViewGroup) LayoutInflater.from(context)
                .inflate(R.layout.connection_row, list, false);
        list.addView(row);
        TextView nameView = row.findViewById(R.id.connection_name);
        nameView.setText(name);
        screen.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
        screen.layout(0, 0, screen.getMeasuredWidth(), screen.getMeasuredHeight());

        Rect icon = bounds(row, row.findViewById(R.id.connection_device_icon));
        Rect labels = bounds(row, (View) nameView.getParent());
        Rect menu = bounds(row, row.findViewById(R.id.connection_more_button));
        assertEquals("Device icon and menu must share a vertical center",
                menu.exactCenterY(), icon.exactCenterY(), 1f);
        assertEquals("Name and subtitle must center as one block",
                menu.exactCenterY(), labels.exactCenterY(), 1f);
        assertTrue("Text stays inside the row", labels.top >= 0 && labels.bottom <= row.getHeight());
        assertTrue("Text does not overlap the menu", labels.right <= menu.left);
    }

    private Rect bounds(ViewGroup row, View child) {
        Rect result = new Rect(0, 0, child.getWidth(), child.getHeight());
        row.offsetDescendantRectToMyCoords(child, result);
        return result;
    }
}
