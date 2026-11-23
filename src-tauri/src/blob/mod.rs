use crate::{
    diff::{self, DiffRef, DiffSource, Side},
    error::{Error, Result},
    media::{is_image, mime},
    repo::Registry,
};
use tauri::Manager;

#[derive(Debug)]
pub struct Blob {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

fn content_kind(path: &str) -> &'static str {
    if is_image(path) {
        return "Image";
    }
    "File"
}

pub async fn serve<R: tauri::Runtime>(app: &tauri::AppHandle<R>, uri: String) -> Result<Blob> {
    let url = tauri::Url::parse(&uri).map_err(|error| Error::refused(error.to_string()))?;
    let parameters: std::collections::HashMap<String, String> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let get = |key: &str| parameters.get(key).map(String::as_str).unwrap_or_default();
    let repo = app.state::<Registry>().get(get("repo")).await?;
    let path = get("path");
    let reference = DiffRef {
        path,
        source: DiffSource::parse(get("source"))?,
        revision: get("revision"),
        base: get("base"),
    };
    let side = Side::of(get("side") == "old");
    if diff::size(&repo, reference, side).await? > diff::BLOB_SIZE_LIMIT {
        let kind = content_kind(path);
        let megabytes = diff::BLOB_SIZE_LIMIT / diff::BYTES_PER_MEGABYTE;
        return Err(Error::refused(format!(
            "{kind} exceeds the {megabytes} MB limit"
        )));
    }
    let bytes = diff::bytes(&repo, reference, side).await?;
    Ok(Blob {
        bytes,
        mime: mime(path),
    })
}
