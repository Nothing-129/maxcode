package app.codeg.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class UrlNormalizerTest {
    @Test
    public void freshEntriesBypassOldHtmlCacheWithoutChangingOriginOrRoute() {
        for (String path : new String[] {"/login", "/workspace"}) {
            String first = UrlNormalizer.freshEntry("https://example.com:3086", path);
            String second = UrlNormalizer.freshEntry("https://example.com:3086", path);
            java.net.URI uri = java.net.URI.create(first);
            assertEquals(path, uri.getPath());
            assertTrue(uri.getQuery().startsWith("_frontend_reload="));
            assertTrue(UrlNormalizer.isSameOrigin("https://example.com:3086", first));
            assertFalse(first.equals(second));
        }
    }

    @Test
    public void defaultsBareLanAddressToHttp() {
        assertEquals(
                "http://192.168.1.20:3030",
                UrlNormalizer.normalize(" 192.168.1.20:3030/ "));
    }

    @Test
    public void normalizesSchemeHostAndDefaultPort() {
        assertEquals(
                "https://example.com",
                UrlNormalizer.normalize("HTTPS://Example.COM:443/"));
    }

    @Test
    public void acceptsIpv6ServerAddress() {
        assertEquals(
                "http://[2001:db8::1]:3030",
                UrlNormalizer.normalize("http://[2001:db8::1]:3030"));
    }

    @Test
    public void rejectsUnsafeOrUnsupportedUrlParts() {
        assertThrows(
                IllegalArgumentException.class,
                () -> UrlNormalizer.normalize("ftp://example.com"));
        assertThrows(
                IllegalArgumentException.class,
                () -> UrlNormalizer.normalize("https://user:pass@example.com"));
    }

    @Test
    public void preservesDeepLinksWithoutProbingOrRewritingParameters() {
        String url = "https://zcode.z.ai/remote/v4?sid=test%2Fvalue&next=%23chat#section";
        assertEquals(url, UrlNormalizer.normalize(url));
        assertEquals("https://zcode.z.ai", UrlNormalizer.origin(url));
        assertFalse(UrlNormalizer.shouldBootstrap(new ConnectionConfig(url, "")));
        assertFalse(UrlNormalizer.shouldBootstrap(new ConnectionConfig(url, "optional")));
        assertFalse(UrlNormalizer.shouldBootstrap(new ConnectionConfig("https://example.com", "")));
        assertTrue(UrlNormalizer.shouldBootstrap(new ConnectionConfig("https://example.com", "token")));
        assertEquals("https://example.com/?a=1#b",
                UrlNormalizer.normalize("https://example.com/?a=1#b"));
        assertEquals("http://offline.invalid/path?q=1",
                UrlNormalizer.normalize("offline.invalid/path?q=1"));
    }

    @Test
    public void comparesOriginsWithDefaultPorts() {
        assertTrue(UrlNormalizer.isSameOrigin(
                "https://example.com",
                "https://EXAMPLE.com:443/workspace"));
        assertFalse(UrlNormalizer.isSameOrigin(
                "https://example.com",
                "http://example.com/workspace"));
        assertFalse(UrlNormalizer.isSameOrigin(
                "https://example.com",
                "https://example.com:8443/workspace"));
    }
}
