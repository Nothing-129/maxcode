use std::path::Path;

pub(crate) fn load_package_scripts_as_commands(folder_path: &str) -> Vec<(String, String)> {
    let mut has_package_json = false;
    let mut has_pnpm_lock = false;
    let mut has_yarn_lock = false;
    let mut has_bun_lock = false;

    let entries = match std::fs::read_dir(folder_path) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let Some(file_name) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        match file_name.as_str() {
            "package.json" => has_package_json = true,
            "pnpm-lock.yaml" => has_pnpm_lock = true,
            "yarn.lock" => has_yarn_lock = true,
            "bun.lockb" | "bun.lock" => has_bun_lock = true,
            _ => {}
        }
    }

    if !has_package_json {
        return Vec::new();
    }

    let package_json_path = Path::new(folder_path).join("package.json");
    let package_json_content = match std::fs::read_to_string(package_json_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    let package_json: serde_json::Value = match serde_json::from_str(&package_json_content) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let package_manager = if has_pnpm_lock {
        "pnpm"
    } else if has_yarn_lock {
        "yarn"
    } else if has_bun_lock {
        "bun"
    } else {
        "npm"
    };

    let mut commands = Vec::new();
    if let Some(scripts) = package_json.get("scripts").and_then(|s| s.as_object()) {
        for (script_name, script_value) in scripts {
            if script_name.trim().is_empty() || script_value.as_str().is_none() {
                continue;
            }
            commands.push((
                script_name.to_string(),
                format!("{package_manager} run {script_name}"),
            ));
        }
    }

    commands
}
