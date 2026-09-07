package app.codeg.web;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNull;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
public class FileChooserResultTest {
    private static final Uri FIRST = Uri.parse("content://documents/image/1");
    private static final Uri SECOND = Uri.parse("content://documents/image/2");

    @Test
    public void acceptsOneImageReturnedOnlyInClipData() {
        Intent data = new Intent();
        data.setClipData(ClipData.newRawUri("image", FIRST));
        assertArrayEquals(new Uri[] {FIRST}, FileChooserResult.parse(Activity.RESULT_OK, data));
    }

    @Test
    public void preservesMultipleImagesEvenWithSingleDataUri() {
        Intent data = new Intent().setData(FIRST);
        ClipData clip = ClipData.newRawUri("images", FIRST);
        clip.addItem(new ClipData.Item(SECOND));
        clip.addItem(new ClipData.Item(FIRST));
        data.setClipData(clip);
        assertArrayEquals(new Uri[] {FIRST, SECOND},
                FileChooserResult.parse(Activity.RESULT_OK, data));
    }

    @Test
    public void acceptsSingleDataUri() {
        assertArrayEquals(new Uri[] {FIRST},
                FileChooserResult.parse(Activity.RESULT_OK, new Intent().setData(FIRST)));
    }

    @Test
    public void ignoresNonUriClipItemsAndFallsBackToData() {
        Intent data = new Intent().setData(FIRST);
        data.setClipData(ClipData.newPlainText("text", "not a file"));
        assertArrayEquals(new Uri[] {FIRST}, FileChooserResult.parse(Activity.RESULT_OK, data));
        data.setData(null);
        assertNull(FileChooserResult.parse(Activity.RESULT_OK, data));
    }

    @Test
    public void cancellationAndMissingResultsDoNotAttachFiles() {
        assertNull(FileChooserResult.parse(Activity.RESULT_CANCELED, new Intent().setData(FIRST)));
        assertNull(FileChooserResult.parse(Activity.RESULT_OK, null));
        assertNull(FileChooserResult.parse(Activity.RESULT_OK, new Intent()));
    }
}
