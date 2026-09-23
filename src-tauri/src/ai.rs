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

pub const DIFF_BUDGET: usize = 175_000;
pub const MESSAGE_CAP: usize = 4000;
pub const TIMEOUT: Duration = Duration::from_secs(60);

const LAST_REASONING_TIER: usize = 3;
const THINK_OPEN: [&str; 3] = ["<think>", "<thinking>", "<reasoning>"];
const THINK_CLOSE: [&str; 3] = ["</think>", "</thinking>", "</reasoning>"];
static REASONING_TIER: AtomicUsize = AtomicUsize::new(0);
const PINNED: [&str; 5] = [
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];
const NOISE: [&str; 8] = [
    ".lock",
    "lock.yaml",
    "lock.json",
    ".snap",
    ".svg",
    ".min.js",
    ".min.css",
    ".map",
];
const OUTLINE_INDENT: usize = 2;
const TRUNCATED: &str = "\n… the remaining files are omitted\n";
const COMPACTED: &str = "Generated files show only their header, and long files show their opening lines followed by an outline of their remaining top-level changes. Write exactly one commit message from what is shown. Do not offer templates or alternatives, and do not ask for more detail.";
const CONTEXT_SIGNS: [&str; 7] = [
    "context_length_exceeded",
    "context length",
    "context window",
    "context size",
    "maximum context",
    "too many tokens",
    "prompt is too long",
];

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
    Compacted,
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
    let builder = reqwest::Client::builder().timeout(endpoint.timeout);
    #[cfg(feature = "test-utils")]
    let builder = builder.no_proxy();
    let transport = builder.build()?;
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

async fn patch(root: &Path, staged: bool) -> Result<String> {
    let mut arguments = vec!["diff"];
    if staged {
        arguments.push("--cached");
    }
    arguments.extend(PINNED);
    git::text(root, &arguments).await
}

pub async fn material(root: &Path) -> Result<Material> {
    let staged = patch(root, true).await?;
    let (source, patch) = if staged.trim().is_empty() {
        (Source::WorkingTree, patch(root, false).await?)
    } else {
        (Source::Index, staged)
    };
    if patch.trim().is_empty() {
        return Err(Error::refused("There are no changes to describe"));
    }
    if width(&patch) <= DIFF_BUDGET {
        return Ok(Material {
            text: patch,
            source,
            detail: Detail::Patch,
        });
    }
    Ok(Material {
        text: compact(&patch, DIFF_BUDGET),
        source,
        detail: Detail::Compacted,
    })
}

fn width(text: &str) -> usize {
    text.chars().count()
}

fn sections(patch: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = patch
        .match_indices("\ndiff --git ")
        .map(|(at, _)| at + 1)
        .collect();
    starts.insert(0, 0);
    starts.push(patch.len());
    starts
        .windows(2)
        .map(|pair| &patch[pair[0]..pair[1]])
        .filter(|section| !section.is_empty())
        .collect()
}

fn split_header(section: &str) -> (&str, &str) {
    section.split_at(section.find("\n@@").map_or(section.len(), |at| at + 1))
}

fn noisy(section: &str) -> bool {
    let header = section.lines().next().unwrap_or_default().trim_end();
    NOISE.iter().any(|suffix| header.ends_with(suffix))
}

fn changed(line: &str) -> bool {
    line.starts_with(['+', '-'])
}

fn outlined(line: &str) -> bool {
    if line.starts_with("@@") {
        return true;
    }
    let Some(content) = line.strip_prefix(['+', '-']) else {
        return false;
    };
    let text = content.trim_start_matches(' ');
    width(content) - width(text) <= OUTLINE_INDENT
        && !text.starts_with('\t')
        && text
            .trim()
            .chars()
            .any(|symbol| !matches!(symbol, ')' | '}' | ']' | ';' | ','))
}

fn stub(section: &str) -> String {
    let (header, body) = split_header(section);
    let omitted = body.lines().filter(|line| changed(line)).count();
    format!("{header}… {omitted} changed lines omitted\n")
}

fn share(sizes: &[usize], budget: usize) -> usize {
    let mut sorted = sizes.to_vec();
    sorted.sort_unstable();
    let mut left = budget;
    for (index, size) in sorted.iter().enumerate() {
        let even = left / (sorted.len() - index);
        if *size > even {
            return even;
        }
        left -= size;
    }
    usize::MAX
}

fn clip(text: String, limit: usize) -> String {
    if width(&text) <= limit {
        return text;
    }
    let kept: String = text
        .chars()
        .take(limit.saturating_sub(width(TRUNCATED)))
        .collect();
    format!("{kept}{TRUNCATED}")
}

fn shrink(section: &str, cap: usize) -> String {
    let (header, body) = split_header(section);
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let marker =
        |omitted: usize| format!("… {omitted} more changed lines omitted, outline follows\n");
    let outline: usize = lines
        .iter()
        .filter(|line| outlined(line))
        .map(|line| width(line))
        .sum();
    let total_changed = lines.iter().filter(|line| changed(line)).count();
    let mut room = cap.saturating_sub(width(header) + width(&marker(total_changed)) + outline);
    let head = lines
        .iter()
        .take_while(|line| {
            let fits = width(line) <= room;
            if fits {
                room -= width(line);
            }
            fits
        })
        .count();
    let rest = &lines[head..];
    let omitted = rest.iter().filter(|line| changed(line)).count();
    let text = [header]
        .into_iter()
        .chain(lines[..head].iter().copied())
        .map(str::to_string)
        .chain([marker(omitted)])
        .chain(
            rest.iter()
                .filter(|line| outlined(line))
                .map(|line| line.to_string()),
        )
        .collect();
    clip(text, cap)
}

pub fn compact(patch: &str, budget: usize) -> String {
    let sections: Vec<(String, bool)> = sections(patch)
        .into_iter()
        .map(|section| match noisy(section) {
            true => (stub(section), true),
            false => (section.to_string(), false),
        })
        .collect();
    let fixed: usize = sections
        .iter()
        .filter(|(_, noise)| *noise)
        .map(|(text, _)| width(text))
        .sum();
    let sizes: Vec<usize> = sections
        .iter()
        .filter(|(_, noise)| !noise)
        .map(|(text, _)| width(text))
        .collect();
    let cap = share(&sizes, budget.saturating_sub(fixed));
    let text = sections
        .iter()
        .map(|(text, noise)| match *noise || width(text) <= cap {
            true => text.clone(),
            false => shrink(text, cap),
        })
        .collect();
    clip(text, budget)
}

pub fn prompt(template: &str, material: &Material) -> String {
    let template = match template.trim() {
        "" => DEFAULT_PROMPT,
        value => value,
    };
    let introduction = match (material.source, material.detail) {
        (Source::Index, Detail::Patch) => "The staged patch follows.".to_string(),
        (Source::Index, Detail::Compacted) => {
            format!("The staged patch exceeds the budget, so a compacted patch follows. {COMPACTED}")
        }
        (Source::WorkingTree, Detail::Patch) => {
            "Nothing is staged, so the unstaged working tree patch follows.".to_string()
        }
        (Source::WorkingTree, Detail::Compacted) => format!(
            "Nothing is staged and the working tree patch exceeds the budget, so a compacted patch follows. {COMPACTED}"
        ),
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

fn exceeds_context(error: &OpenAIError) -> bool {
    let text = match error {
        OpenAIError::ApiError(response) if response.status_code.as_u16() == 413 => return true,
        OpenAIError::ApiError(response) => response.api_error.to_string(),
        OpenAIError::JSONDeserialize(_, content) => content.clone(),
        _ => return false,
    }
    .to_lowercase();
    CONTEXT_SIGNS.iter().any(|sign| text.contains(sign))
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
            Err(error) if exceeds_context(&error) => {
                return Err(Error::refused(
                    "The changes are too large for this model's context",
                ));
            }
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
