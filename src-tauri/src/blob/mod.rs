use crate::{
    diff::{self, DiffSource},
    error::{Error, Result},
    media::{is_image, mime},
    repo::Registry,
};
use tauri::Manager;

fn content_kind(path: &str) -> &'static str {
    if is_image(path) {
        return "Image";
    }
    "File"
}

pub async fn serve<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    uri: String,
) -> Result<(Vec<u8>, &'static str)> {
    let url = tauri::Url::parse(&uri).map_err(|error| Error::refused(error.to_string()))?;
    let parameters: std::collections::HashMap<String, String> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let get = |key: &str| parameters.get(key).map(String::as_str).unwrap_or_default();
    let repo = app.state::<Registry>().get(get("repo")).await?;
    let path = get("path");
    let source = DiffSource::parse(get("source"))?;
    if diff::size(
        &repo,
        path,
        source,
        get("revision"),
        get("base"),
        get("side") == "old",
    )
    .await?
        > diff::BLOB_SIZE_LIMIT
    {
        let kind = content_kind(path);
        let megabytes = diff::BLOB_SIZE_LIMIT / diff::BYTES_PER_MEGABYTE;
        return Err(Error::refused(format!(
            "{kind} exceeds the {megabytes} MB limit"
        )));
    }
    let bytes = diff::bytes(
        &repo,
        path,
        source,
        get("revision"),
        get("base"),
        get("side") == "old",
    )
    .await?;
    Ok((bytes, mime(path)))
}
