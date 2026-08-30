package app.codeg.web;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class ConnectionCatalog {
    private final List<ConnectionConfig> connections;
    private final String activeId;

    private ConnectionCatalog(List<ConnectionConfig> connections, String activeId) {
        this.connections = Collections.unmodifiableList(new ArrayList<>(connections));
        this.activeId = findById(connections, activeId) == null
                ? firstId(connections)
                : activeId;
    }

    static ConnectionCatalog empty() {
        return new ConnectionCatalog(Collections.emptyList(), null);
    }

    static ConnectionCatalog restore(
            List<ConnectionConfig> connections,
            String activeId) {
        ConnectionCatalog deduplicated = empty();
        for (ConnectionConfig connection : connections) {
            deduplicated = deduplicated.upsertAndActivate(connection);
        }
        return new ConnectionCatalog(deduplicated.connections, activeId);
    }

    List<ConnectionConfig> connections() {
        return connections;
    }

    ConnectionConfig active() {
        return findById(connections, activeId);
    }

    ConnectionCatalog upsertAndActivate(ConnectionConfig candidate) {
        ConnectionConfig existingById = findById(connections, candidate.id());
        ConnectionConfig existingByUrl = findByUrl(connections, candidate.baseUrl());
        ConnectionConfig replacement;
        if (existingById != null) {
            replacement = candidate;
        } else if (existingByUrl != null) {
            replacement = new ConnectionConfig(
                    existingByUrl.id(),
                    candidate.name(),
                    candidate.baseUrl(),
                    candidate.token());
        } else {
            replacement = candidate;
        }

        List<ConnectionConfig> updated = new ArrayList<>();
        boolean inserted = false;
        for (ConnectionConfig connection : connections) {
            if (connection.id().equals(replacement.id())) {
                updated.add(replacement);
                inserted = true;
            } else if (!connection.baseUrl().equals(replacement.baseUrl())) {
                updated.add(connection);
            }
        }
        if (!inserted) {
            updated.add(replacement);
        }
        return new ConnectionCatalog(updated, replacement.id());
    }

    ConnectionCatalog activate(String id) {
        if (findById(connections, id) == null) {
            throw new IllegalArgumentException("Unknown connection id");
        }
        return new ConnectionCatalog(connections, id);
    }

    ConnectionCatalog remove(String id) {
        List<ConnectionConfig> updated = new ArrayList<>();
        for (ConnectionConfig connection : connections) {
            if (!connection.id().equals(id)) {
                updated.add(connection);
            }
        }
        String nextActiveId = id.equals(activeId) ? firstId(updated) : activeId;
        return new ConnectionCatalog(updated, nextActiveId);
    }

    private static ConnectionConfig findById(
            List<ConnectionConfig> connections,
            String id) {
        if (id == null) return null;
        for (ConnectionConfig connection : connections) {
            if (id.equals(connection.id())) return connection;
        }
        return null;
    }

    private static ConnectionConfig findByUrl(
            List<ConnectionConfig> connections,
            String baseUrl) {
        for (ConnectionConfig connection : connections) {
            if (baseUrl.equals(connection.baseUrl())) return connection;
        }
        return null;
    }

    private static String firstId(List<ConnectionConfig> connections) {
        return connections.isEmpty() ? null : connections.get(0).id();
    }
}
