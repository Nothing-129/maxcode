package app.codeg.web;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class DeviceCompatibilityTest {
    @Test
    public void enablesStatusBarWorkaroundForOppoManufacturerOrBrand() {
        assertTrue(DeviceCompatibility.needsOppoStatusBarWorkaround("OPPO", "OPPO"));
        assertTrue(DeviceCompatibility.needsOppoStatusBarWorkaround("unknown", "oppo"));
    }

    @Test
    public void leavesXiaomiAndOtherManufacturersUnchanged() {
        assertFalse(DeviceCompatibility.needsOppoStatusBarWorkaround("Xiaomi", "Redmi"));
        assertFalse(DeviceCompatibility.needsOppoStatusBarWorkaround("Google", "Pixel"));
    }
}
