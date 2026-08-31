package app.codeg.web;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.method.PasswordTransformationMethod;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.ClientCertRequest;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.net.URI;
import java.net.URISyntaxException;
import java.security.GeneralSecurityException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final long WAKE_DELAY_MILLIS = 250L;

    private enum SetupMode {
        SELECT,
        INITIAL,
        ADD,
        EDIT
    }

    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final ServerHealthChecker healthChecker = new ServerHealthChecker();

    private View setupScreen;
    private View browserScreen;
    private View rootView;
    private TextView setupTitle;
    private TextView setupSubtitle;
    private View connectionChooser;
    private LinearLayout savedConnectionsList;
    private Button addConnectionButton;
    private ProgressBar chooserProgress;
    private View setupForm;
    private EditText connectionNameInput;
    private EditText serverUrlInput;
    private EditText tokenInput;
    private CheckBox showTokenCheckbox;
    private TextView connectionError;
    private TextView httpWarning;
    private Button connectButton;
    private Button cancelButton;
    private ProgressBar connectProgress;
    private ProgressBar pageProgress;
    private WebView webView;

    private SecureConfigStore configStore;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private ValueCallback<Uri[]> filePathCallback;
    private ConnectionCatalog catalog = ConnectionCatalog.empty();
    private ConnectionConfig activeConfig;
    private ConnectionConfig editingConnection;
    private SetupMode setupMode = SetupMode.SELECT;
    private boolean bootstrapPending;
    private boolean clearHistoryAfterWorkspace;
    private boolean mainFrameFailed;
    private boolean connecting;
    private boolean browserImmersive;
    private final boolean needsOppoStatusBarWorkaround =
            DeviceCompatibility.needsOppoStatusBarWorkaround(
                    Build.MANUFACTURER,
                    Build.BRAND);
    private int statusBarInsetCssPixels;
    private volatile boolean destroyed;

    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        setContentView(R.layout.activity_main);

        bindViews();
        applySystemBarInsets(rootView);
        configStore = new SecureConfigStore(getApplicationContext());
        connectivityManager =
                (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);

        configureSetupScreen();
        configureWebView();
        registerNetworkCallback();
        registerPredictiveBackIfAvailable();
        catalog = configStore.loadCatalog();
        showConnectionChooser();
    }

    private void bindViews() {
        rootView = findViewById(R.id.root);
        setupScreen = findViewById(R.id.setup_screen);
        browserScreen = findViewById(R.id.browser_screen);
        setupTitle = findViewById(R.id.setup_title);
        setupSubtitle = findViewById(R.id.setup_subtitle);
        connectionChooser = findViewById(R.id.connection_chooser);
        savedConnectionsList = findViewById(R.id.saved_connections_list);
        addConnectionButton = findViewById(R.id.add_connection_button);
        chooserProgress = findViewById(R.id.chooser_progress);
        setupForm = findViewById(R.id.setup_form);
        connectionNameInput = findViewById(R.id.connection_name_input);
        serverUrlInput = findViewById(R.id.server_url_input);
        tokenInput = findViewById(R.id.token_input);
        showTokenCheckbox = findViewById(R.id.show_token_checkbox);
        connectionError = findViewById(R.id.connection_error);
        httpWarning = findViewById(R.id.http_warning);
        connectButton = findViewById(R.id.connect_button);
        cancelButton = findViewById(R.id.cancel_button);
        connectProgress = findViewById(R.id.connect_progress);
        pageProgress = findViewById(R.id.page_progress);
        webView = findViewById(R.id.web_view);
    }

    private void configureSetupScreen() {
        connectButton.setOnClickListener(view -> connect());
        cancelButton.setOnClickListener(view -> cancelSetup());
        addConnectionButton.setOnClickListener(view -> showSetup(SetupMode.ADD, null, 0));
        tokenInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                connect();
                return true;
            }
            return false;
        });
        showTokenCheckbox.setOnCheckedChangeListener((button, checked) -> {
            int cursor = tokenInput.getSelectionStart();
            tokenInput.setTransformationMethod(
                    checked ? null : PasswordTransformationMethod.getInstance());
            if (cursor >= 0) {
                tokenInput.setSelection(Math.min(cursor, tokenInput.length()));
            }
        });
        serverUrlInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence value, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence value, int start, int before, int count) {
                updateHttpWarning(value == null ? "" : value.toString());
            }

            @Override
            public void afterTextChanged(Editable value) {}
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setTextZoom(100);
        settings.setUserAgentString(
                settings.getUserAgentString() + " MaxCodeAndroid/" + BuildConfig.VERSION_NAME);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebViewClient(new CodegWebViewClient());
        webView.setWebChromeClient(new CodegChromeClient());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                openDownloadExternally(url));
    }

    private void connect() {
        hideError();
        String name = connectionNameInput.getText().toString().trim();
        String rawUrl = serverUrlInput.getText().toString();
        String token = tokenInput.getText().toString();
        if (name.isEmpty()) {
            showError(R.string.error_name_required);
            connectionNameInput.requestFocus();
            return;
        }
        if (name.indexOf('\r') >= 0 || name.indexOf('\n') >= 0) {
            showError(R.string.error_name_format);
            connectionNameInput.requestFocus();
            return;
        }
        if (rawUrl.trim().isEmpty()) {
            showError(R.string.error_url_required);
            serverUrlInput.requestFocus();
            return;
        }
        if (token.isEmpty()) {
            showError(R.string.error_token_required);
            tokenInput.requestFocus();
            return;
        }
        if (token.indexOf('\r') >= 0 || token.indexOf('\n') >= 0) {
            showError(R.string.error_token_format);
            tokenInput.requestFocus();
            return;
        }

        final String baseUrl;
        try {
            baseUrl = UrlNormalizer.normalize(rawUrl);
        } catch (IllegalArgumentException error) {
            showError(R.string.error_invalid_url);
            serverUrlInput.requestFocus();
            return;
        }

        ConnectionConfig config = setupMode == SetupMode.EDIT && editingConnection != null
                ? new ConnectionConfig(editingConnection.id(), name, baseUrl, token)
                : new ConnectionConfig(name, baseUrl, token);
        setConnecting(true);
        ioExecutor.execute(() -> {
            ServerHealthChecker.Result result = healthChecker.check(config);
            ConnectionCatalog updatedCatalog = null;
            if (result.kind() == ServerHealthChecker.Kind.OK) {
                try {
                    updatedCatalog = configStore.upsertAndActivate(config);
                } catch (GeneralSecurityException error) {
                    // The UI reports a secure-storage error below.
                }
            }
            ConnectionCatalog finalUpdatedCatalog = updatedCatalog;
            runOnUiThread(() -> handleConnectResult(result, finalUpdatedCatalog));
        });
    }

    private void handleConnectResult(
            ServerHealthChecker.Result result,
            ConnectionCatalog updatedCatalog) {
        if (destroyed) return;
        setConnecting(false);
        if (result.kind() == ServerHealthChecker.Kind.OK && updatedCatalog != null) {
            catalog = updatedCatalog;
            ConnectionConfig saved = updatedCatalog.active();
            if (saved == null) {
                showError(R.string.error_secure_store);
                return;
            }
            startBrowser(saved);
            return;
        }
        if (result.kind() == ServerHealthChecker.Kind.OK) {
            showError(R.string.error_secure_store);
            return;
        }
        switch (result.kind()) {
            case UNAUTHORIZED -> showError(R.string.error_unauthorized);
            case REDIRECT -> showError(R.string.error_redirect);
            case HTTP_ERROR -> showError(
                    getString(R.string.error_http_status, result.statusCode()));
            case TLS_ERROR -> showError(R.string.error_tls);
            case NETWORK_ERROR -> showError(R.string.error_network);
            case OK -> throw new IllegalStateException("Handled above");
        }
    }

    private void showConnectionChooser() {
        setImmersiveStatusBar(false);
        activeConfig = null;
        editingConnection = null;
        bootstrapPending = false;
        clearHistoryAfterWorkspace = false;
        mainFrameFailed = false;
        if (catalog.connections().isEmpty()) {
            showSetup(SetupMode.INITIAL, null, 0);
            return;
        }

        setupMode = SetupMode.SELECT;
        browserScreen.setVisibility(View.GONE);
        setupScreen.setVisibility(View.VISIBLE);
        connectionChooser.setVisibility(View.VISIBLE);
        setupForm.setVisibility(View.GONE);
        setupTitle.setText(R.string.setup_title_select);
        setupSubtitle.setText(R.string.setup_subtitle_select);
        tokenInput.setText("");
        hideError();
        if (webView != null) webView.onPause();
        renderConnections();
        setChooserEnabled(true);
    }

    private void renderConnections() {
        savedConnectionsList.removeAllViews();
        for (int index = 0; index < catalog.connections().size(); index++) {
            ConnectionConfig connection = catalog.connections().get(index);
            View row = getLayoutInflater()
                    .inflate(R.layout.connection_row, savedConnectionsList, false);
            Button openButton = row.findViewById(R.id.open_connection_button);
            Button editButton = row.findViewById(R.id.edit_connection_button);
            Button deleteButton = row.findViewById(R.id.delete_connection_button);
            View divider = row.findViewById(R.id.connection_divider);
            openButton.setText(connection.name());
            openButton.setOnClickListener(view -> selectConnection(connection));
            editButton.setOnClickListener(
                    view -> showSetup(SetupMode.EDIT, connection, 0));
            deleteButton.setOnClickListener(
                    view -> confirmDeleteConnection(connection));
            divider.setVisibility(
                    index == catalog.connections().size() - 1 ? View.GONE : View.VISIBLE);
            savedConnectionsList.addView(row);
        }
    }

    private void setChooserEnabled(boolean enabled) {
        addConnectionButton.setEnabled(enabled);
        setViewTreeEnabled(savedConnectionsList, enabled);
        chooserProgress.setVisibility(enabled ? View.GONE : View.VISIBLE);
    }

    private void setViewTreeEnabled(View view, boolean enabled) {
        view.setEnabled(enabled);
        if (!(view instanceof ViewGroup group)) return;
        for (int index = 0; index < group.getChildCount(); index++) {
            setViewTreeEnabled(group.getChildAt(index), enabled);
        }
    }

    private void selectConnection(ConnectionConfig connection) {
        setChooserEnabled(false);
        ioExecutor.execute(() -> {
            ConnectionCatalog updated = null;
            try {
                updated = configStore.activate(connection.id());
            } catch (GeneralSecurityException | IllegalArgumentException error) {
                // The UI reports the failed operation below.
            }
            ConnectionCatalog finalUpdated = updated;
            runOnUiThread(() -> {
                if (destroyed) return;
                if (finalUpdated == null || finalUpdated.active() == null) {
                    setChooserEnabled(true);
                    Toast.makeText(
                                    this,
                                    R.string.connection_switch_failed,
                                    Toast.LENGTH_SHORT)
                            .show();
                    return;
                }
                catalog = finalUpdated;
                startBrowser(finalUpdated.active());
            });
        });
    }

    private void confirmDeleteConnection(ConnectionConfig connection) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.delete_connection_title)
                .setMessage(getString(
                        R.string.delete_connection_message,
                        connection.name()))
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(
                        R.string.delete,
                        (dialog, which) -> deleteConnection(connection))
                .show();
    }

    private void deleteConnection(ConnectionConfig connection) {
        setChooserEnabled(false);
        ioExecutor.execute(() -> {
            ConnectionCatalog updated = null;
            try {
                updated = configStore.remove(connection.id());
            } catch (GeneralSecurityException error) {
                // The UI reports the failed operation below.
            }
            ConnectionCatalog finalUpdated = updated;
            runOnUiThread(() -> {
                if (destroyed) return;
                if (finalUpdated == null) {
                    setChooserEnabled(true);
                    Toast.makeText(
                                    this,
                                    R.string.connection_switch_failed,
                                    Toast.LENGTH_SHORT)
                            .show();
                    return;
                }
                catalog = finalUpdated;
                Toast.makeText(this, R.string.connection_deleted, Toast.LENGTH_SHORT).show();
                showConnectionChooser();
            });
        });
    }

    private void startBrowser(ConnectionConfig config) {
        if (activeConfig != null
                && !UrlNormalizer.origin(activeConfig.baseUrl())
                        .equals(UrlNormalizer.origin(config.baseUrl()))) {
            WebStorage.getInstance().deleteOrigin(UrlNormalizer.origin(activeConfig.baseUrl()));
        }
        activeConfig = config;
        editingConnection = null;
        setupMode = SetupMode.SELECT;
        bootstrapPending = true;
        clearHistoryAfterWorkspace = true;
        mainFrameFailed = false;

        tokenInput.setText("");
        cancelButton.setVisibility(View.GONE);
        setImmersiveStatusBar(true);
        setupScreen.setVisibility(View.GONE);
        browserScreen.setVisibility(View.VISIBLE);
        pageProgress.setVisibility(View.VISIBLE);
        webView.onResume();
        webView.clearHistory();
        webView.loadUrl(UrlNormalizer.route(config.baseUrl(), "/login"));
    }

    private void showSetup(
            SetupMode mode,
            ConnectionConfig connection,
            int errorResource) {
        setImmersiveStatusBar(false);
        setupMode = mode;
        editingConnection = mode == SetupMode.EDIT ? connection : null;
        browserScreen.setVisibility(View.GONE);
        setupScreen.setVisibility(View.VISIBLE);
        connectionChooser.setVisibility(View.GONE);
        setupForm.setVisibility(View.VISIBLE);
        if (webView != null) webView.onPause();

        switch (mode) {
            case INITIAL -> {
                setupTitle.setText(R.string.setup_title);
                setupSubtitle.setText(R.string.setup_subtitle);
            }
            case ADD -> {
                setupTitle.setText(R.string.setup_title_add);
                setupSubtitle.setText(R.string.setup_subtitle_add);
            }
            case EDIT -> {
                setupTitle.setText(R.string.setup_title_edit);
                setupSubtitle.setText(R.string.setup_subtitle_edit);
            }
            case SELECT -> throw new IllegalArgumentException("Use showConnectionChooser");
        }
        String name = connection == null ? "" : connection.name();
        String url = connection == null ? "" : connection.baseUrl();
        String token = connection == null ? "" : connection.token();
        connectionNameInput.setText(name);
        serverUrlInput.setText(url);
        tokenInput.setText(token);
        showTokenCheckbox.setChecked(false);
        tokenInput.setTransformationMethod(PasswordTransformationMethod.getInstance());
        cancelButton.setVisibility(
                mode == SetupMode.INITIAL || catalog.connections().isEmpty()
                        ? View.GONE
                        : View.VISIBLE);
        setConnecting(false);
        if (errorResource == 0) {
            hideError();
        } else {
            showError(errorResource);
        }
        updateHttpWarning(url);
    }

    private void cancelSetup() {
        if (connecting) return;
        if (catalog.connections().isEmpty()) {
            finish();
            return;
        }
        showConnectionChooser();
    }

    private void setConnecting(boolean connecting) {
        this.connecting = connecting;
        connectButton.setEnabled(!connecting);
        cancelButton.setEnabled(!connecting);
        connectionNameInput.setEnabled(!connecting);
        serverUrlInput.setEnabled(!connecting);
        tokenInput.setEnabled(!connecting);
        showTokenCheckbox.setEnabled(!connecting);
        connectButton.setText(connecting ? R.string.connecting : R.string.connect);
        connectProgress.setVisibility(connecting ? View.VISIBLE : View.GONE);
    }

    private void updateHttpWarning(String rawUrl) {
        String value = rawUrl.trim().toLowerCase(Locale.ROOT);
        httpWarning.setVisibility(value.startsWith("https://") ? View.GONE : View.VISIBLE);
    }

    private void hideError() {
        connectionError.setText("");
        connectionError.setVisibility(View.GONE);
    }

    private void showError(int stringResource) {
        showError(getString(stringResource));
    }

    private void showError(String message) {
        connectionError.setText(message);
        connectionError.setVisibility(View.VISIBLE);
    }

    private void notifyWebWake() {
        if (activeConfig == null
                || webView == null
                || browserScreen.getVisibility() != View.VISIBLE) {
            return;
        }
        String currentUrl = webView.getUrl();
        if (!UrlNormalizer.isSameOrigin(activeConfig.baseUrl(), currentUrl)) return;
        webView.evaluateJavascript(WebBootstrapScript.wake(), null);
    }

    private void registerNetworkCallback() {
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (destroyed
                            || activeConfig == null
                            || webView == null
                            || browserScreen.getVisibility() != View.VISIBLE) {
                        return;
                    }
                    if (mainFrameFailed) {
                        mainFrameFailed = false;
                        webView.reload();
                    } else {
                        notifyWebWake();
                    }
                });
            }
        };
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException error) {
            networkCallback = null;
        }
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String url = uri.toString();
        if (activeConfig != null && UrlNormalizer.isSameOrigin(activeConfig.baseUrl(), url)) {
            return false;
        }
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
        if ("about".equals(normalizedScheme)
                || "blob".equals(normalizedScheme)
                || "data".equals(normalizedScheme)) {
            return false;
        }
        if ("http".equals(normalizedScheme)
                || "https".equals(normalizedScheme)
                || "mailto".equals(normalizedScheme)
                || "tel".equals(normalizedScheme)) {
            openExternal(uri);
        }
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.external_link_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void openDownloadExternally(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (scheme == null
                || (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
            Toast.makeText(this, R.string.download_not_supported, Toast.LENGTH_SHORT).show();
            return;
        }
        openExternal(uri);
        Toast.makeText(this, R.string.download_opened_externally, Toast.LENGTH_SHORT).show();
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarInsets(View root) {
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = windowInsets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left;
                top = bars.top;
                if (needsOppoStatusBarWorkaround) {
                    Insets topSafeArea = windowInsets.getInsetsIgnoringVisibility(
                            WindowInsets.Type.statusBars()
                                    | WindowInsets.Type.displayCutout());
                    top = Math.max(top, topSafeArea.top);
                }
                right = bars.right;
                bottom = bars.bottom;
            } else {
                left = windowInsets.getSystemWindowInsetLeft();
                top = windowInsets.getSystemWindowInsetTop();
                right = windowInsets.getSystemWindowInsetRight();
                bottom = windowInsets.getSystemWindowInsetBottom();
            }
            int cssPixels = Math.round(
                    top / getResources().getDisplayMetrics().density);
            if (statusBarInsetCssPixels != cssPixels) {
                statusBarInsetCssPixels = cssPixels;
                if (browserImmersive && webView != null) {
                    webView.post(() -> injectStatusBarSafeArea(webView));
                }
            }
            view.setPadding(left, browserImmersive ? 0 : top, right, bottom);
            return windowInsets;
        });
        root.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void setImmersiveStatusBar(boolean immersive) {
        browserImmersive = immersive;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = immersive
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attributes);
        }
        getWindow().setStatusBarColor(
                immersive ? Color.TRANSPARENT : getColor(R.color.surface));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars());
                int appearance = usesLightSystemIcons()
                        ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        : 0;
                controller.setSystemBarsAppearance(
                        appearance,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else {
            View decorView = getWindow().getDecorView();
            int visibility = decorView.getSystemUiVisibility();
            visibility &= ~View.SYSTEM_UI_FLAG_FULLSCREEN;
            if (immersive) {
                visibility |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            } else {
                visibility &= ~View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            }
            if (usesLightSystemIcons()) {
                visibility |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                visibility &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            decorView.setSystemUiVisibility(visibility);
        }
        rootView.setPadding(
                rootView.getPaddingLeft(),
                immersive ? 0 : rootView.getPaddingTop(),
                rootView.getPaddingRight(),
                rootView.getPaddingBottom());
        rootView.requestApplyInsets();
    }

    private boolean usesLightSystemIcons() {
        int nightMode = getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK;
        return nightMode != Configuration.UI_MODE_NIGHT_YES;
    }

    private void injectStatusBarSafeArea(WebView target) {
        if (!browserImmersive || activeConfig == null || target == null) return;
        String currentUrl = target.getUrl();
        if (!UrlNormalizer.isSameOrigin(activeConfig.baseUrl(), currentUrl)) return;
        target.evaluateJavascript(
                WebBootstrapScript.setAndroidStatusBarInset(
                        statusBarInsetCssPixels,
                        needsOppoStatusBarWorkaround),
                null);
    }

    private void registerPredictiveBackIfAvailable() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerPredictiveBack();
        }
    }

    @TargetApi(Build.VERSION_CODES.TIRAMISU)
    private void registerPredictiveBack() {
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                this::handleBack);
    }

    private void handleBack() {
        if (browserScreen.getVisibility() == View.VISIBLE) {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
            } else {
                finish();
            }
            return;
        }
        if (connecting) return;
        if (setupMode != SetupMode.INITIAL
                && setupMode != SetupMode.SELECT
                && !catalog.connections().isEmpty()) {
            cancelSetup();
            return;
        }
        finish();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (browserScreen != null
                && webView != null
                && browserScreen.getVisibility() == View.VISIBLE) {
            webView.onResume();
            webView.postDelayed(this::notifyWebWake, WAKE_DELAY_MILLIS);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                // The callback may already have been removed by the system.
            }
        }
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        ioExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class CodegWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return handleNavigation(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if ("about:blank".equals(url)) return;
            mainFrameFailed = false;
            pageProgress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (activeConfig == null
                    || mainFrameFailed
                    || !UrlNormalizer.isSameOrigin(activeConfig.baseUrl(), url)) {
                return;
            }

            if (bootstrapPending) {
                bootstrapPending = false;
                String workspaceUrl = UrlNormalizer.route(activeConfig.baseUrl(), "/workspace");
                view.evaluateJavascript(
                        WebBootstrapScript.create(activeConfig.token(), workspaceUrl),
                        null);
                return;
            }

            injectStatusBarSafeArea(view);
            pageProgress.setVisibility(View.GONE);
            if (clearHistoryAfterWorkspace && isWorkspacePage(url)) {
                clearHistoryAfterWorkspace = false;
                view.clearHistory();
            }
        }

        @Override
        public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame()) return;
            mainFrameFailed = true;
            pageProgress.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedSslError(
                WebView view,
                SslErrorHandler handler,
                SslError error) {
            handler.cancel();
            mainFrameFailed = true;
            pageProgress.setVisibility(View.GONE);
            Toast.makeText(MainActivity.this, R.string.error_tls, Toast.LENGTH_LONG).show();
        }

        @Override
        public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) {
            request.cancel();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) {
                parent.removeView(view);
            }
            view.destroy();
            webView = null;
            recreate();
            return true;
        }
    }

    private final class CodegChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            super.onProgressChanged(view, newProgress);
            pageProgress.setProgress(newProgress);
            if (newProgress >= 100 && !bootstrapPending && !mainFrameFailed) {
                pageProgress.setVisibility(View.GONE);
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            try {
                Intent intent = params.createIntent();
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            } catch (ActivityNotFoundException error) {
                filePathCallback = null;
                Toast.makeText(MainActivity.this, R.string.file_picker_failed, Toast.LENGTH_SHORT)
                        .show();
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin,
                android.webkit.GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }

    private static boolean isWorkspacePage(String url) {
        try {
            String path = new URI(url).getPath();
            return path != null
                    && (path.equals("/workspace") || path.equals("/workspace.html"));
        } catch (URISyntaxException error) {
            return false;
        }
    }
}
