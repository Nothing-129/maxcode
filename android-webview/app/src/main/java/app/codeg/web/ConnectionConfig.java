package app.codeg.web;

import java.util.UUID;

final class ConnectionConfig {
    private final String id;
    private final String name;
    private final String baseUrl;
    private final String token;

    ConnectionConfig(String baseUrl, String token) {
        this(UUID.randomUUID().toString(), baseUrl, baseUrl, token);
    }

    ConnectionConfig(String name, String baseUrl, String token) {
        this(UUID.randomUUID().toString(), name, baseUrl, token);
    }

    ConnectionConfig(String id, String name, String baseUrl, String token) {
        this.id = id;
        this.name = name;
        this.baseUrl = baseUrl;
        this.token = token;
    }

    String id() {
        return id;
    }

    String name() {
        return name;
    }

    String baseUrl() {
        return baseUrl;
    }

    String token() {
        return token;
    }
}
