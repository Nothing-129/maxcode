package app.codeg.web;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureConfigStore {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "codeg_web_connection_v1";
    private static final String PREFERENCES = "codeg_web_secure_config_v1";

    private static final String CONNECTIONS_KEY = "connections_json_v2";
    private static final String ACTIVE_ID_KEY = "active_connection_id_v2";
    private static final String JSON_ID = "id";
    private static final String JSON_NAME = "name";
    private static final String JSON_URL = "url";
    private static final String JSON_CIPHERTEXT = "token_ciphertext";
    private static final String JSON_IV = "token_iv";

    private static final String LEGACY_URL_KEY = "server_url";
    private static final String LEGACY_CIPHERTEXT_KEY = "token_ciphertext";
    private static final String LEGACY_IV_KEY = "token_iv";

    private final SharedPreferences preferences;

    SecureConfigStore(Context context) {
        preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    synchronized ConnectionCatalog loadCatalog() {
        if (preferences.contains(CONNECTIONS_KEY)) {
            return loadStoredCatalog();
        }
        return migrateLegacyConnection();
    }

    synchronized ConnectionCatalog upsertAndActivate(ConnectionConfig config)
            throws GeneralSecurityException {
        ConnectionCatalog updated = loadCatalog().upsertAndActivate(config);
        persistCatalog(updated);
        return updated;
    }

    synchronized ConnectionCatalog activate(String id) throws GeneralSecurityException {
        ConnectionCatalog updated = loadCatalog().activate(id);
        persistCatalog(updated);
        return updated;
    }

    synchronized ConnectionCatalog remove(String id) throws GeneralSecurityException {
        ConnectionCatalog updated = loadCatalog().remove(id);
        persistCatalog(updated);
        return updated;
    }

    private ConnectionCatalog loadStoredCatalog() {
        String serialized = preferences.getString(CONNECTIONS_KEY, "[]");
        if (serialized == null) return ConnectionCatalog.empty();

        try {
            JSONArray array = new JSONArray(serialized);
            SecretKey key = array.length() == 0 ? null : existingKey();
            if (array.length() > 0 && key == null) return ConnectionCatalog.empty();

            List<ConnectionConfig> connections = new ArrayList<>();
            for (int index = 0; index < array.length(); index++) {
                JSONObject object = array.optJSONObject(index);
                if (object == null) continue;
                String id = object.optString(JSON_ID, "");
                String url = object.optString(JSON_URL, "");
                String name = object.optString(JSON_NAME, url).trim();
                if (name.isEmpty()) name = url;
                String ciphertext = object.optString(JSON_CIPHERTEXT, "");
                String iv = object.optString(JSON_IV, "");
                if (id.isEmpty() || url.isEmpty() || ciphertext.isEmpty() || iv.isEmpty()) {
                    continue;
                }
                try {
                    String token = decryptToken(key, aad(id, url), ciphertext, iv);
                    connections.add(new ConnectionConfig(id, name, url, token));
                } catch (GeneralSecurityException | IllegalArgumentException ignored) {
                    // Keep other independently encrypted connections usable.
                }
            }
            String activeId = preferences.getString(ACTIVE_ID_KEY, null);
            return ConnectionCatalog.restore(connections, activeId);
        } catch (JSONException | GeneralSecurityException error) {
            return ConnectionCatalog.empty();
        }
    }

    private ConnectionCatalog migrateLegacyConnection() {
        String url = preferences.getString(LEGACY_URL_KEY, "");
        String ciphertext = preferences.getString(LEGACY_CIPHERTEXT_KEY, "");
        String iv = preferences.getString(LEGACY_IV_KEY, "");
        if (url == null
                || ciphertext == null
                || iv == null
                || url.isEmpty()
                || ciphertext.isEmpty()
                || iv.isEmpty()) {
            return ConnectionCatalog.empty();
        }

        try {
            SecretKey key = existingKey();
            if (key == null) return ConnectionCatalog.empty();
            String token = decryptToken(
                    key,
                    url.getBytes(StandardCharsets.UTF_8),
                    ciphertext,
                    iv);
            ConnectionCatalog migrated = ConnectionCatalog.empty()
                    .upsertAndActivate(new ConnectionConfig(url, token));
            persistCatalog(migrated);
            return migrated;
        } catch (GeneralSecurityException | IllegalArgumentException error) {
            return ConnectionCatalog.empty();
        }
    }

    private void persistCatalog(ConnectionCatalog catalog) throws GeneralSecurityException {
        SecretKey key = null;
        if (!catalog.connections().isEmpty()) {
            key = existingKey();
            if (key == null) key = createKey();
        }

        try {
            JSONArray array = new JSONArray();
            for (ConnectionConfig connection : catalog.connections()) {
                EncryptedToken encrypted = encryptToken(key, connection);
                JSONObject object = new JSONObject();
                object.put(JSON_ID, connection.id());
                object.put(JSON_NAME, connection.name());
                object.put(JSON_URL, connection.baseUrl());
                object.put(JSON_CIPHERTEXT, encrypted.ciphertext);
                object.put(JSON_IV, encrypted.iv);
                array.put(object);
            }

            SharedPreferences.Editor editor = preferences.edit()
                    .putString(CONNECTIONS_KEY, array.toString())
                    .remove(LEGACY_URL_KEY)
                    .remove(LEGACY_CIPHERTEXT_KEY)
                    .remove(LEGACY_IV_KEY);
            ConnectionConfig active = catalog.active();
            if (active == null) {
                editor.remove(ACTIVE_ID_KEY);
            } else {
                editor.putString(ACTIVE_ID_KEY, active.id());
            }
            if (!editor.commit()) {
                throw new GeneralSecurityException("Secure preferences commit failed");
            }
        } catch (JSONException error) {
            throw new GeneralSecurityException("Could not serialize connections", error);
        }
    }

    private static EncryptedToken encryptToken(
            SecretKey key,
            ConnectionConfig connection) throws GeneralSecurityException {
        if (key == null) {
            throw new GeneralSecurityException("Encryption key is unavailable");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(aad(connection.id(), connection.baseUrl()));
        byte[] ciphertext = cipher.doFinal(
                connection.token().getBytes(StandardCharsets.UTF_8));
        return new EncryptedToken(
                Base64.encodeToString(ciphertext, Base64.NO_WRAP),
                Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
    }

    private static String decryptToken(
            SecretKey key,
            byte[] aad,
            String ciphertext,
            String iv) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        cipher.updateAAD(aad);
        byte[] plaintext = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
        return new String(plaintext, StandardCharsets.UTF_8);
    }

    private static byte[] aad(String id, String url) {
        return (id + "\n" + url).getBytes(StandardCharsets.UTF_8);
    }

    private SecretKey existingKey() throws GeneralSecurityException {
        try {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        } catch (GeneralSecurityException error) {
            throw error;
        } catch (Exception error) {
            throw new GeneralSecurityException("Could not read Android Keystore", error);
        }
    }

    private SecretKey createKey() throws GeneralSecurityException {
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static final class EncryptedToken {
        private final String ciphertext;
        private final String iv;

        private EncryptedToken(String ciphertext, String iv) {
            this.ciphertext = ciphertext;
            this.iv = iv;
        }
    }
}
