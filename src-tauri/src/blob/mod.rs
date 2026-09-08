use crate::{
    diff,
    error::{Error, Result},
    repo::Registry,
};
use tauri::Manager;

pub async fn serve<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    uri: String,
) -> Result<(Vec<u8>, &'static str)> {
    let url = tauri::Url::parse(&uri).map_err(|e| Error::refused(e.to_string()))?;
    let args: std::collections::HashMap<String, String> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let get = |key: &str| args.get(key).map(String::as_str).unwrap_or_default();
    let handle = app.state::<Registry>().get(get("repo")).await?;
    let repo = handle.lock().await;
    let path = get("path");
    if diff::size(
        &repo,
        path,
        get("source"),
        get("revision"),
        get("side") == "old",
    )
    .await?
        > 20 * 1024 * 1024
    {
        return Err(Error::refused(if diff::is_image(path) {
            "Image exceeds the 20 MB limit"
        } else {
            "File exceeds the 20 MB limit"
        }));
    }
    let bytes = diff::bytes(
        &repo,
        path,
        get("source"),
        get("revision"),
        get("side") == "old",
    )
    .await?;
    Ok((bytes, mime(path)))
}

pub fn mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "png" => "image/png",
        _ => "text/plain; charset=utf-8",
    }
}
