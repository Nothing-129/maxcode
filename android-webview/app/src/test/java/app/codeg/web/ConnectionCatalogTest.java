package app.codeg.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import org.junit.Test;

import java.util.Arrays;

public final class ConnectionCatalogTest {
    @Test
    public void emptyCatalogHasNoActiveConnection() {
        ConnectionCatalog catalog = ConnectionCatalog.empty();

        assertEquals(0, catalog.connections().size());
        assertNull(catalog.active());
    }

    @Test
    public void legacyConnectionUsesItsUrlAsTheDisplayName() {
        ConnectionConfig connection = new ConnectionConfig(
                "https://legacy.example",
                "legacy-token");

        assertEquals("https://legacy.example", connection.name());
    }

    @Test
    public void upsertAddsConnectionsAndActivatesTheLatest() {
        ConnectionConfig first = config("first", "https://one.example", "token-one");
        ConnectionConfig second = config("second", "https://two.example", "token-two");

        ConnectionCatalog catalog = ConnectionCatalog.empty()
                .upsertAndActivate(first)
                .upsertAndActivate(second);

        assertEquals(2, catalog.connections().size());
        assertSame(second, catalog.active());
        assertSame(first, catalog.activate(first.id()).active());
    }

    @Test
    public void addingAnExistingUrlUpdatesItWithoutCreatingADuplicate() {
        ConnectionConfig original = config("original", "https://one.example", "old-token");
        ConnectionConfig duplicate = config("new-id", "https://one.example", "new-token");

        ConnectionCatalog catalog = ConnectionCatalog.empty()
                .upsertAndActivate(original)
                .upsertAndActivate(duplicate);

        assertEquals(1, catalog.connections().size());
        assertEquals("original", catalog.active().id());
        assertEquals("Connection new-id", catalog.active().name());
        assertEquals("new-token", catalog.active().token());
    }

    @Test
    public void editingKeepsItsIdAndRemovesAConflictingUrl() {
        ConnectionConfig first = config("first", "https://one.example", "token-one");
        ConnectionConfig second = config("second", "https://two.example", "token-two");
        ConnectionCatalog catalog = ConnectionCatalog.restore(
                Arrays.asList(first, second),
                first.id());

        ConnectionCatalog edited = catalog.upsertAndActivate(
                config("first", "https://two.example", "replacement"));

        assertEquals(1, edited.connections().size());
        assertEquals("first", edited.active().id());
        assertEquals("replacement", edited.active().token());
    }

    @Test
    public void removingTheActiveConnectionFallsBackToTheFirstRemainingOne() {
        ConnectionConfig first = config("first", "https://one.example", "token-one");
        ConnectionConfig second = config("second", "https://two.example", "token-two");
        ConnectionCatalog catalog = ConnectionCatalog.restore(
                Arrays.asList(first, second),
                second.id());

        ConnectionCatalog remaining = catalog.remove(second.id());

        assertEquals(1, remaining.connections().size());
        assertSame(first, remaining.active());
        assertNull(remaining.remove(first.id()).active());
    }

    private static ConnectionConfig config(String id, String url, String token) {
        return new ConnectionConfig(id, "Connection " + id, url, token);
    }
}
