package app.codeg.web;

import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

final class UrlNormalizer {
    private static final Pattern SCHEME =
            Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*://");

    private UrlNormalizer() {}

    // Bypass HTML cached by older releases before no-cache headers existed.
    // Keep subresource URLs stable so content-hashed JS/CSS still use their cache.
    static String freshEntry(String normalizedBaseUrl, String path) {
        return route(normalizedBaseUrl, path) + "?_frontend_reload=" + UUID.randomUUID();
    }

    static String normalize(String rawValue) {
        if (rawValue == null) {
            throw new IllegalArgumentException("URL is required");
        }

        String value = rawValue.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("URL is required");
        }
        if (!SCHEME.matcher(value).find()) {
            value = "http://" + value;
        }

        try {
            URI uri = new URI(value);
            String scheme = lower(uri.getScheme());
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                throw new IllegalArgumentException("Only HTTP and HTTPS are supported");
            }
            if (uri.getRawUserInfo() != null) {
                throw new IllegalArgumentException("Embedded credentials are not supported");
            }
            String rawPath = uri.getRawPath();

            String host = uri.getHost();
            if (host == null || host.trim().isEmpty()) {
                throw new IllegalArgumentException("URL host is missing");
            }
            host = normalizeHost(host);

            int port = uri.getPort();
            if (port == 0 || port > 65_535) {
                throw new IllegalArgumentException("URL port is invalid");
            }
            if (("http".equals(scheme) && port == 80)
                    || ("https".equals(scheme) && port == 443)) {
                port = -1;
            }

            String origin = new URI(scheme, null, host, port, null, null, null).toASCIIString();
            String path = rawPath == null ? "" : rawPath;
            if ("/".equals(path) && uri.getRawQuery() == null && uri.getRawFragment() == null) {
                path = "";
            }
            return origin + path
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())
                    + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
        } catch (URISyntaxException | IllegalArgumentException error) {
            throw new IllegalArgumentException("Invalid MaxCode server URL", error);
        }
    }

    static String route(String normalizedBaseUrl, String absolutePath) {
        if (absolutePath == null || !absolutePath.startsWith("/")) {
            throw new IllegalArgumentException("Route must start with /");
        }
        return origin(normalizedBaseUrl) + absolutePath;
    }

    static boolean isSameOrigin(String normalizedBaseUrl, String candidateUrl) {
        if (normalizedBaseUrl == null || candidateUrl == null) {
            return false;
        }
        try {
            URI base = new URI(normalize(normalizedBaseUrl));
            URI candidate = new URI(candidateUrl);
            return lower(base.getScheme()).equals(lower(candidate.getScheme()))
                    && normalizeHost(base.getHost()).equals(normalizeHost(candidate.getHost()))
                    && effectivePort(base) == effectivePort(candidate);
        } catch (IllegalArgumentException | URISyntaxException error) {
            return false;
        }
    }

    static String origin(String normalizedBaseUrl) {
        URI uri = URI.create(normalize(normalizedBaseUrl));
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }

    static boolean shouldBootstrap(ConnectionConfig config) {
        return !config.token().isEmpty()
                && normalize(config.baseUrl()).equals(origin(config.baseUrl()));
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) {
            return uri.getPort();
        }
        return "https".equals(lower(uri.getScheme())) ? 443 : 80;
    }

    private static String normalizeHost(String host) {
        if (host == null) {
            throw new IllegalArgumentException("URL host is missing");
        }
        String unwrapped = host;
        if (host.startsWith("[") && host.endsWith("]")) {
            unwrapped = host.substring(1, host.length() - 1);
        }
        if (unwrapped.contains(":")) {
            return unwrapped.toLowerCase(Locale.ROOT);
        }
        return IDN.toASCII(unwrapped, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
