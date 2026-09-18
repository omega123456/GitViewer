use crate::{
    error::{Error, Result},
    git,
    settings::DEFAULT_PROMPT,
};
use async_openai::{config::OpenAIConfig, error::OpenAIError, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

pub const DIFF_BUDGET: usize = 32000;
pub const MESSAGE_CAP: usize = 4000;
pub const TIMEOUT: Duration = Duration::from_secs(60);

const LAST_REASONING_TIER: usize = 3;
const THINK_OPEN: [&str; 3] = ["<think>", "<thinking>", "<reasoning>"];
const THINK_CLOSE: [&str; 3] = ["</think>", "</thinking>", "</reasoning>"];
static REASONING_TIER: AtomicUsize = AtomicUsize::new(0);

#[cfg(not(feature = "test-utils"))]
const SERVICE: &str = "GitViewer";
#[cfg(not(feature = "test-utils"))]
const ACCOUNT: &str = "openai-compatible-endpoint";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Index,
    WorkingTree,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Detail {
    Patch,
    Summary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Material {
    pub text: String,
    pub source: Source,
    pub detail: Detail,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub message: String,
    pub source: Source,
    pub detail: Detail,
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Endpoint {
    pub base_url: String,
    pub key: String,
    pub timeout: Duration,
}

impl Endpoint {
    pub fn new(base_url: &str, key: &str) -> Self {
        Self {
            base_url: base_url.trim().trim_end_matches('/').to_string(),
            key: key.to_string(),
            timeout: TIMEOUT,
        }
    }
}

#[cfg(feature = "test-utils")]
static STORED_KEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(feature = "test-utils")]
pub fn key() -> Result<Option<String>> {
    Ok(STORED_KEY
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone())
}

#[cfg(feature = "test-utils")]
pub fn set_key(value: &str) -> Result<()> {
    let mut stored = STORED_KEY.lock().unwrap_or_else(|error| error.into_inner());
    *stored = (!value.is_empty()).then(|| value.to_string());
    Ok(())
}

#[cfg(not(feature = "test-utils"))]
pub fn key() -> Result<Option<String>> {
    match keyring::Entry::new(SERVICE, ACCOUNT)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(Error::from(error)),
    }
}

#[cfg(not(feature = "test-utils"))]
pub fn set_key(value: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(Error::from(error)),
        };
    }
    entry.set_password(value).map_err(Error::from)
}

pub fn key_stored() -> bool {
    key().ok().flatten().is_some()
}

fn client(endpoint: &Endpoint) -> Result<Client<OpenAIConfig>> {
    if endpoint.base_url.is_empty() {
        return Err(Error::refused("No endpoint is configured"));
    }
    let transport = reqwest::Client::builder()
        .timeout(endpoint.timeout)
        .build()?;
    let configuration = OpenAIConfig::new()
        .with_api_base(endpoint.base_url.clone())
        .with_api_key(endpoint.key.clone());
    Ok(Client::build(transport, configuration))
}

pub async fn models(endpoint: &Endpoint) -> Result<Vec<String>> {
    let listed: ModelList = client(endpoint)?.models().list_byot().await?;
    let mut names: Vec<String> = listed.data.into_iter().map(|model| model.id).collect();
    names.sort();
    names.dedup();
    Ok(names)
}

pub async fn material(root: &Path) -> Result<Material> {
    let staged = git::text(root, &["diff", "--cached"]).await?;
    let (source, patch) = if staged.trim().is_empty() {
        (Source::WorkingTree, git::text(root, &["diff"]).await?)
    } else {
        (Source::Index, staged)
    };
    if patch.trim().is_empty() {
        return Err(Error::refused("There are no changes to describe"));
    }
    if patch.chars().count() <= DIFF_BUDGET {
        return Ok(Material {
            text: patch,
            source,
            detail: Detail::Patch,
        });
    }
    let arguments: &[&str] = match source {
        Source::Index => &["diff", "--cached", "--stat"],
        Source::WorkingTree => &["diff", "--stat"],
    };
    Ok(Material {
        text: git::text(root, arguments).await?,
        source,
        detail: Detail::Summary,
    })
}

pub fn prompt(template: &str, material: &Material) -> String {
    let template = match template.trim() {
        "" => DEFAULT_PROMPT,
        value => value,
    };
    let introduction = match (material.source, material.detail) {
        (Source::Index, Detail::Patch) => "The staged patch follows.",
        (Source::Index, Detail::Summary) => {
            "The staged changes exceed the patch budget, so a per-file summary follows."
        }
        (Source::WorkingTree, Detail::Patch) => {
            "Nothing is staged, so the unstaged working tree patch follows."
        }
        (Source::WorkingTree, Detail::Summary) => {
            "Nothing is staged and the working tree changes exceed the patch budget, so a per-file summary follows."
        }
    };
    format!("{template}\n\n{introduction}\n\n{}", material.text)
}

fn reasoning_off_fields(tier: usize) -> Value {
    match tier {
        0 => json!({
            "reasoning_effort": "none",
            "reasoning": {"enabled": false, "exclude": true},
            "thinking": {"type": "disabled", "budget_tokens": 0},
            "enable_thinking": false,
            "think": false,
            "thinking_budget": 0,
            "reasoning_budget": 0,
            "thinking_budget_tokens": 0,
            "chat_template_kwargs": {"enable_thinking": false, "thinking": false, "reasoning": false},
            "google": {"thinking_config": {"thinking_budget": 0, "include_thoughts": false}},
        }),
        1 => json!({"reasoning_effort": "none"}),
        2 => json!({"reasoning_effort": "low"}),
        _ => json!({}),
    }
}

fn request_body(model: &str, prompt: &str, tier: usize) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false,
    });
    if let (Some(body), Some(fields)) =
        (body.as_object_mut(), reasoning_off_fields(tier).as_object())
    {
        body.extend(fields.clone());
    }
    body
}

fn rejects_the_body(error: &OpenAIError) -> bool {
    match error {
        OpenAIError::ApiError(response) => response.status_code.as_u16() == 400,
        OpenAIError::JSONDeserialize(..) => true,
        _ => false,
    }
}

fn first_tag(text: &str, tags: &[&str]) -> Option<(usize, usize)> {
    tags.iter()
        .filter_map(|tag| text.find(tag).map(|at| (at, tag.len())))
        .min_by_key(|(at, _)| *at)
}

pub fn strip_think_blocks(text: &str) -> String {
    let mut text = text.to_string();
    while let Some((open_at, open_len)) = first_tag(&text, &THINK_OPEN) {
        let after_open = open_at + open_len;
        match first_tag(&text[after_open..], &THINK_CLOSE) {
            Some((close_at, close_len)) => {
                text.replace_range(open_at..after_open + close_at + close_len, "");
            }
            None => text.truncate(open_at),
        }
    }
    text
}

fn trim(text: &str) -> Result<String> {
    let text = strip_think_blocks(text);
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::refused("The endpoint returned an empty message"));
    }
    Ok(text.chars().take(MESSAGE_CAP).collect())
}

pub async fn draft(
    endpoint: &Endpoint,
    model: &str,
    template: &str,
    material: Material,
) -> Result<Draft> {
    if model.trim().is_empty() {
        return Err(Error::refused("No model is configured"));
    }
    let client = client(endpoint)?;
    let prompt = prompt(template, &material);
    let completion: Completion = loop {
        let tier = REASONING_TIER.load(Ordering::SeqCst);
        match client
            .chat()
            .create_byot(request_body(model.trim(), &prompt, tier))
            .await
        {
            Ok(completion) => break completion,
            Err(error) if rejects_the_body(&error) && tier < LAST_REASONING_TIER => {
                REASONING_TIER.store(tier + 1, Ordering::SeqCst);
            }
            Err(error) => return Err(Error::from(error)),
        }
    };
    let text = completion
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .ok_or_else(|| Error::refused("The endpoint returned no message"))?;
    Ok(Draft {
        message: trim(&text)?,
        source: material.source,
        detail: material.detail,
    })
}
