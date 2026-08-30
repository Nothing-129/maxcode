package app.codeg.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class UrlNormalizerTest {
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
        assertThrows(
                IllegalArgumentException.class,
                () -> UrlNormalizer.normalize("https://example.com/codeg"));
        assertThrows(
                IllegalArgumentException.class,
                () -> UrlNormalizer.normalize("https://example.com?token=nope"));
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
