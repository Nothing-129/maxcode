package app.codeg.web;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import java.util.LinkedHashSet;
import java.util.Set;

/** Reads both single-file and multi-select results from Android document providers. */
final class FileChooserResult {
    private FileChooserResult() {}

    static Uri[] parse(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null) return null;

        // In multiple-selection mode a provider may return only ClipData,
        // even when the user selected just one file. Do not interpret that
        // as cancellation or truncate a multi-selection to getData().
        Set<Uri> uris = new LinkedHashSet<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        if (uris.isEmpty() && data.getData() != null) uris.add(data.getData());
        return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
    }
}
