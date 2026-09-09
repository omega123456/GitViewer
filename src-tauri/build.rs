fn main() {
    println!("cargo::rerun-if-env-changed=TAURI_CONFIG");
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        let mut config: serde_json::Value = std::env::var("TAURI_CONFIG")
            .ok()
            .map(|value| serde_json::from_str(&value).expect("Invalid TAURI_CONFIG"))
            .unwrap_or_else(|| serde_json::json!({}));
        config["identifier"] = serde_json::json!("com.gitviewer.desktop.dev");
        let config = config.to_string();
        println!("cargo::rustc-env=TAURI_CONFIG={config}");
        std::env::set_var("TAURI_CONFIG", config);
    }
    tauri_build::build()
}
