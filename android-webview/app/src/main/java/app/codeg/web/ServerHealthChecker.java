package app.codeg.web;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.SSLException;

final class ServerHealthChecker {
    private static final int TIMEOUT_MILLIS = 8_000;
    private static final byte[] EMPTY_JSON = "{}".getBytes(StandardCharsets.UTF_8);

    enum Kind {
        OK,
        UNAUTHORIZED,
        REDIRECT,
        HTTP_ERROR,
        NETWORK_ERROR,
        TLS_ERROR
    }

    static final class Result {
        private final Kind kind;
        private final int statusCode;

        Result(Kind kind, int statusCode) {
            this.kind = kind;
            this.statusCode = statusCode;
        }

        Kind kind() {
            return kind;
        }

        int statusCode() {
            return statusCode;
        }
    }

    Result check(ConnectionConfig config) {
        HttpURLConnection connection = null;
        try {
            URL healthUrl = new URL(UrlNormalizer.route(config.baseUrl(), "/api/health"));
            connection = (HttpURLConnection) healthUrl.openConnection();
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(TIMEOUT_MILLIS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(EMPTY_JSON.length);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + config.token());
            connection.setRequestProperty("User-Agent", "MaxCodeAndroid/" + BuildConfig.VERSION_NAME);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(EMPTY_JSON);
            }

            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) {
                return new Result(Kind.OK, status);
            }
            if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
                return new Result(Kind.UNAUTHORIZED, status);
            }
            if (status >= 300 && status < 400) {
                return new Result(Kind.REDIRECT, status);
            }
            return new Result(Kind.HTTP_ERROR, status);
        } catch (SSLException error) {
            return new Result(Kind.TLS_ERROR, 0);
        } catch (IOException | IllegalArgumentException error) {
            return new Result(Kind.NETWORK_ERROR, 0);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}
