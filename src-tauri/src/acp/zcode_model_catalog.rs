//! Temporary compatibility for bridge 0.72.0 / 0.76.1 / 0.76.2.
//! Use the native session's available models; never invent provider aliases.
use std::path::Path;

const MARKER: &str = "// MaxCode: full native session model catalog v2";
const PATCHES: &[(&str, &str)] = &[
    (
        "    let thoughtOptions = null;",
        "    let thoughtOptions = null;\n    // MaxCode: full native session model catalog v2\n    let runtimeModels = null;",
    ),
    (
        "            const modelSet = settings.model ?? {};",
        r#"            const modelSet = settings.model ?? {};
            // session/read deliberately returns only the current model.
            // create/resume cache the complete native catalog on the server.
            const fullCatalog = server.modelAvailability?.get(zcodeSid);
            if (Array.isArray(fullCatalog)) {
                runtimeModels = fullCatalog
                    .filter((entry) => typeof entry.providerId === "string" && typeof entry.modelId === "string")
                    .map((entry) => ({
                        providerId: entry.providerId,
                        modelId: entry.modelId,
                        providerName: entry.providerId,
                    }));
            }"#,
    ),
    (
        "currentProviderId = configProviderIdFor(cur.providerId);",
        "currentProviderId = runtimeModels === null ? configProviderIdFor(cur.providerId) : cur.providerId;",
    ),
    (
        "    const allModels = loadAllModels();",
        "    const allModels = runtimeModels ?? loadAllModels();",
    ),
    (
        "    if (!modelOptions.some((o) => o.value === currentModel)) {",
        "    if (runtimeModels === null && !modelOptions.some((o) => o.value === currentModel)) {",
    ),
];

fn patched_source(source: &str) -> Result<Option<String>, String> {
    if source.contains(MARKER) {
        return Ok(None);
    }
    // Refuse partial or ambiguous edits when an adapter changes its implementation.
    if PATCHES
        .iter()
        .any(|(old, _)| source.matches(old).count() != 1)
    {
        return Err("ZCode bridge has an unexpected model catalog implementation; refused to apply compatibility repair".into());
    }
    let mut result = source.to_owned();
    for (old, new) in PATCHES {
        result = result.replacen(old, new, 1);
    }
    Ok(Some(result))
}

pub fn ensure(entry: &Path) -> Result<(), String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(package) = entry.parent().and_then(Path::parent) else {
        return Ok(());
    };
    let metadata = std::fs::read_to_string(package.join("package.json"))
        .map_err(|e| format!("read ZCode bridge metadata: {e}"))?;
    let metadata: serde_json::Value =
        serde_json::from_str(&metadata).map_err(|e| format!("parse ZCode bridge metadata: {e}"))?;
    if metadata["name"] != "zcode-acp-server"
        || !matches!(
            metadata["version"].as_str(),
            Some("0.72.0" | "0.76.1" | "0.76.2")
        )
    {
        return Ok(());
    }
    let options = package.join("dist/config/options.js");
    let source =
        std::fs::read_to_string(&options).map_err(|e| format!("read ZCode model catalog: {e}"))?;
    if let Some(patched) = patched_source(&source)? {
        // Replace atomically so simultaneous launches never import a partial file.
        let temp = options.with_extension(format!("maxcode-{}.tmp", std::process::id()));
        std::fs::write(&temp, patched)
            .and_then(|()| std::fs::rename(&temp, &options))
            .map_err(|e| format!("repair ZCode model catalog: {e}"))?;
        tracing::info!("[ACP][ZCode] use native session model availability");
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/zcode-model-catalog.contract.rs"]
mod contract;
