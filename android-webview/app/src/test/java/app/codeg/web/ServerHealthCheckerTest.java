package app.codeg.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class ServerHealthCheckerTest {
    @Test
    public void sendsBearerTokenToHealthEndpoint() throws Exception {
        try (OneShotHttpServer server = new OneShotHttpServer(200, Map.of())) {
            ServerHealthChecker.Result result = new ServerHealthChecker()
                    .check(new ConnectionConfig(server.baseUrl(), "secret-token"));

            server.awaitRequest();
            assertEquals(ServerHealthChecker.Kind.OK, result.kind());
            assertEquals("POST /api/health HTTP/1.1", server.requestLine());
            assertEquals("Bearer secret-token", server.header("authorization"));
            assertEquals("{}", server.body());
        }
    }

    @Test
    public void classifiesUnauthorizedResponse() throws Exception {
        try (OneShotHttpServer server = new OneShotHttpServer(401, Map.of())) {
            ServerHealthChecker.Result result = new ServerHealthChecker()
                    .check(new ConnectionConfig(server.baseUrl(), "wrong-token"));

            server.awaitRequest();
            assertEquals(ServerHealthChecker.Kind.UNAUTHORIZED, result.kind());
            assertEquals(401, result.statusCode());
        }
    }

    @Test
    public void doesNotFollowRedirect() throws Exception {
        AtomicReference<String> redirectUrl = new AtomicReference<>();
        try (OneShotHttpServer server = new OneShotHttpServer(
                302,
                () -> Map.of("Location", redirectUrl.get()))) {
            redirectUrl.set(server.baseUrl() + "/capture");

            ServerHealthChecker.Result result = new ServerHealthChecker()
                    .check(new ConnectionConfig(server.baseUrl(), "secret-token"));

            server.awaitRequest();
            assertEquals(ServerHealthChecker.Kind.REDIRECT, result.kind());
            assertEquals(1, server.acceptedConnectionCount());
        }
    }

    private interface HeaderSupplier {
        Map<String, String> get();
    }

    private static final class OneShotHttpServer implements AutoCloseable {
        private final ServerSocket serverSocket;
        private final int status;
        private final HeaderSupplier responseHeaders;
        private final CountDownLatch requestFinished = new CountDownLatch(1);
        private final AtomicReference<Throwable> failure = new AtomicReference<>();
        private final Map<String, String> requestHeaders = new LinkedHashMap<>();
        private volatile String requestLine = "";
        private volatile String body = "";
        private volatile int acceptedConnectionCount;
        private final Thread thread;

        OneShotHttpServer(int status, Map<String, String> responseHeaders) throws IOException {
            this(status, () -> responseHeaders);
        }

        OneShotHttpServer(int status, HeaderSupplier responseHeaders) throws IOException {
            this.status = status;
            this.responseHeaders = responseHeaders;
            serverSocket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
            thread = new Thread(this::serveOnce, "codeg-health-test-server");
            thread.setDaemon(true);
            thread.start();
        }

        String baseUrl() {
            return "http://127.0.0.1:" + serverSocket.getLocalPort();
        }

        String requestLine() {
            return requestLine;
        }

        String header(String name) {
            return requestHeaders.get(name.toLowerCase(Locale.ROOT));
        }

        String body() {
            return body;
        }

        int acceptedConnectionCount() {
            return acceptedConnectionCount;
        }

        void awaitRequest() throws Exception {
            assertTrue("Health request did not arrive", requestFinished.await(2, TimeUnit.SECONDS));
            Throwable serverFailure = failure.get();
            if (serverFailure != null) {
                throw new AssertionError("Local HTTP server failed", serverFailure);
            }
        }

        private void serveOnce() {
            try (Socket socket = serverSocket.accept()) {
                acceptedConnectionCount++;
                socket.setSoTimeout(2_000);
                readRequest(socket);
                writeResponse(socket);
            } catch (Throwable error) {
                if (!serverSocket.isClosed()) {
                    failure.set(error);
                }
            } finally {
                requestFinished.countDown();
            }
        }

        private void readRequest(Socket socket) throws IOException {
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    socket.getInputStream(),
                    StandardCharsets.ISO_8859_1));
            requestLine = reader.readLine();
            int contentLength = 0;
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator <= 0) continue;
                String name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(separator + 1).trim();
                requestHeaders.put(name, value);
                if ("content-length".equals(name)) {
                    contentLength = Integer.parseInt(value);
                }
            }
            char[] bodyChars = new char[contentLength];
            int offset = 0;
            while (offset < contentLength) {
                int read = reader.read(bodyChars, offset, contentLength - offset);
                if (read < 0) break;
                offset += read;
            }
            body = new String(bodyChars, 0, offset);
        }

        private void writeResponse(Socket socket) throws IOException {
            String reason = switch (status) {
                case 200 -> "OK";
                case 302 -> "Found";
                case 401 -> "Unauthorized";
                default -> "Test";
            };
            StringBuilder response = new StringBuilder()
                    .append("HTTP/1.1 ")
                    .append(status)
                    .append(' ')
                    .append(reason)
                    .append("\r\n");
            for (Map.Entry<String, String> header : responseHeaders.get().entrySet()) {
                response.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
            }
            response.append("Content-Length: 0\r\nConnection: close\r\n\r\n");
            try (OutputStream output = socket.getOutputStream()) {
                output.write(response.toString().getBytes(StandardCharsets.ISO_8859_1));
                output.flush();
            }
        }

        @Override
        public void close() throws IOException {
            serverSocket.close();
            try {
                thread.join(2_000);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
