package app.codeg.web;

final class DeviceCompatibility {
    private DeviceCompatibility() {}

    static boolean needsOppoStatusBarWorkaround(
            String manufacturer,
            String brand) {
        return "oppo".equalsIgnoreCase(manufacturer)
                || "oppo".equalsIgnoreCase(brand);
    }
}
