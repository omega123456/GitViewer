use crate::{
    error::{Error, Result},
    git,
    lock::lock_recovering,
    repo::Registry,
    settings::{Ai, DEFAULT_PROMPT, Settings},
};
use async_openai::{Client, config::OpenAIConfig, error::OpenAIError};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::Path, sync::Mutex, time::Duration};

pub const DIFF_BUDGET: usize = 175_000;
pub const MESSAGE_CAP: usize = 4000;
pub const TIMEOUT: Duration = Duration::from_secs(120);

const THINK_OPEN: [&str; 3] = ["<think>", "<thinking>", "<reasoning>"];
const THINK_CLOSE: [&str; 3] = ["</think>", "</thinking>", "</reasoning>"];
static REASONING_TIER: Mutex<ReasoningTier> = Mutex::new(ReasoningTier::EveryOffSwitch);
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
const BOUNDARY_PAIR: usize = 2;
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
    pub fn configured(ai: &Ai) -> Result<Self> {
        Ok(Self::new(&ai.base_url, &key()?.unwrap_or_default()))
    }
}

#[cfg(feature = "test-utils")]
static STORED_KEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(feature = "test-utils")]
pub fn key() -> Result<Option<String>> {
    Ok(crate::lock::lock_recovering(&STORED_KEY).clone())
}

#[cfg(feature = "test-utils")]
pub fn set_key(value: &str) -> Result<()> {
    let mut stored = crate::lock::lock_recovering(&STORED_KEY);
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

fn patch_command(staged: bool) -> Vec<&'static str> {
    if staged {
        return vec!["diff", "--cached"];
    }
    vec!["diff-files", "-p"]
}
async fn patch(root: &Path, staged: bool) -> Result<String> {
    let mut arguments = patch_command(staged);
    arguments.extend(git::PINNED_DIFF_FLAGS);
    arguments.extend(git::DIFF_PREFIXES);
    git::text(root, &arguments).await
}

struct Changes {
    source: Source,
    patch: String,
}
async fn changes(root: &Path) -> Result<Changes> {
    let staged = patch(root, true).await?;
    if !staged.trim().is_empty() {
        return Ok(Changes {
            source: Source::Index,
            patch: staged,
        });
    }
    Ok(Changes {
        source: Source::WorkingTree,
        patch: patch(root, false).await?,
    })
}
pub async fn material(root: &Path) -> Result<Material> {
    let Changes { source, patch } = changes(root).await?;
    if patch.trim().is_empty() {
        return Err(Error::refused("There are no changes to describe"));
    }
    if char_count(&patch) <= DIFF_BUDGET {
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

fn char_count(text: &str) -> usize {
    text.chars().count()
}

fn sections(patch: &str) -> Vec<&str> {
    let mut starts: Vec<usize> = patch
        .match_indices("\ndiff --git ")
        .map(|(offset, _)| offset + 1)
        .collect();
    starts.insert(0, 0);
    starts.push(patch.len());
    starts
        .windows(BOUNDARY_PAIR)
        .map(|pair| &patch[pair[0]..pair[1]])
        .filter(|section| !section.is_empty())
        .collect()
}

struct Header<'a> {
    header: &'a str,
    body: &'a str,
}
fn split_header(section: &str) -> Header<'_> {
    let (header, body) = section.split_at(
        section
            .find("\n@@")
            .map_or(section.len(), |offset| offset + 1),
    );
    Header { header, body }
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
    let shallow = char_count(content) - char_count(text) <= OUTLINE_INDENT;
    let tab_indented = text.starts_with('\t');
    shallow && !tab_indented && !closes_scope_only(text)
}
fn is_closing_symbol(symbol: char) -> bool {
    matches!(symbol, ')' | '}' | ']' | ';' | ',')
}
fn closes_scope_only(text: &str) -> bool {
    text.trim().chars().all(is_closing_symbol)
}
fn fitting_lines(lines: &[&str], room: usize) -> usize {
    let mut remaining = room;
    let mut fitting = 0;
    for line in lines {
        let size = char_count(line);
        if size > remaining {
            break;
        }
        remaining -= size;
        fitting += 1;
    }
    fitting
}

fn stub(section: &str) -> String {
    let Header { header, body } = split_header(section);
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
    if char_count(&text) <= limit {
        return text;
    }
    let kept: String = text
        .chars()
        .take(limit.saturating_sub(char_count(TRUNCATED)))
        .collect();
    format!("{kept}{TRUNCATED}")
}

fn shrink(section: &str, cap: usize) -> String {
    let Header { header, body } = split_header(section);
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let marker =
        |omitted: usize| format!("… {omitted} more changed lines omitted, outline follows\n");
    let outline: usize = lines
        .iter()
        .filter(|line| outlined(line))
        .map(|line| char_count(line))
        .sum();
    let total_changed = lines.iter().filter(|line| changed(line)).count();
    let room =
        cap.saturating_sub(char_count(header) + char_count(&marker(total_changed)) + outline);
    let head = fitting_lines(&lines, room);
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

struct Section {
    text: String,
    noise: bool,
}
impl Section {
    fn of(section: &str) -> Self {
        let noise = noisy(section);
        if noise {
            return Self {
                text: stub(section),
                noise,
            };
        }
        Self {
            text: section.to_string(),
            noise,
        }
    }
    fn fits(&self, cap: usize) -> bool {
        self.noise || char_count(&self.text) <= cap
    }
}
pub fn compact(patch: &str, budget: usize) -> String {
    let sections: Vec<Section> = sections(patch).into_iter().map(Section::of).collect();
    let fixed: usize = sections
        .iter()
        .filter(|section| section.noise)
        .map(|section| char_count(&section.text))
        .sum();
    let sizes: Vec<usize> = sections
        .iter()
        .filter(|section| !section.noise)
        .map(|section| char_count(&section.text))
        .collect();
    let cap = share(&sizes, budget.saturating_sub(fixed));
    let text = sections
        .iter()
        .map(|section| match section.fits(cap) {
            true => section.text.clone(),
            false => shrink(&section.text, cap),
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
            format!(
                "The staged patch exceeds the budget, so a compacted patch follows. {COMPACTED}"
            )
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReasoningTier {
    EveryOffSwitch,
    NoEffort,
    LowEffort,
    NoFields,
}
impl ReasoningTier {
    fn off_fields(self) -> Value {
        match self {
            Self::EveryOffSwitch => json!({
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
            Self::NoEffort => json!({"reasoning_effort": "none"}),
            Self::LowEffort => json!({"reasoning_effort": "low"}),
            Self::NoFields => json!({}),
        }
    }
    fn step_down(self) -> Option<Self> {
        match self {
            Self::EveryOffSwitch => Some(Self::NoEffort),
            Self::NoEffort => Some(Self::LowEffort),
            Self::LowEffort => Some(Self::NoFields),
            Self::NoFields => None,
        }
    }
}
fn tier_after_rejection(tier: ReasoningTier, error: OpenAIError) -> Result<ReasoningTier> {
    if !rejects_the_body(&error) {
        return Err(Error::from(error));
    }
    tier.step_down().ok_or_else(|| Error::from(error))
}
fn current_tier() -> ReasoningTier {
    *lock_recovering(&REASONING_TIER)
}
fn remember_tier(tier: ReasoningTier) {
    *lock_recovering(&REASONING_TIER) = tier;
}

fn request_body(model: &str, prompt: &str, tier: ReasoningTier) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false,
    });
    if let (Some(body), Some(fields)) = (body.as_object_mut(), tier.off_fields().as_object()) {
        body.extend(fields.clone());
    }
    body
}

fn rejects_the_body(error: &OpenAIError) -> bool {
    match error {
        OpenAIError::ApiError(response) => response.status_code == StatusCode::BAD_REQUEST,
        OpenAIError::JSONDeserialize(..) => true,
        _ => false,
    }
}

fn exceeds_context(error: &OpenAIError) -> bool {
    let text = match error {
        OpenAIError::ApiError(response)
            if response.status_code == StatusCode::PAYLOAD_TOO_LARGE =>
        {
            return true;
        }
        OpenAIError::ApiError(response) => response.api_error.to_string(),
        OpenAIError::JSONDeserialize(_, content) => content.clone(),
        _ => return false,
    }
    .to_lowercase();
    CONTEXT_SIGNS.iter().any(|sign| text.contains(sign))
}

struct TagSpan {
    offset: usize,
    length: usize,
}
impl TagSpan {
    fn end(&self) -> usize {
        self.offset + self.length
    }
}
fn first_tag(text: &str, tags: &[&str]) -> Option<TagSpan> {
    tags.iter()
        .filter_map(|tag| {
            text.find(tag).map(|offset| TagSpan {
                offset,
                length: tag.len(),
            })
        })
        .min_by_key(|span| span.offset)
}

pub fn strip_think_blocks(text: &str) -> String {
    let mut text = text.to_string();
    while let Some(open) = first_tag(&text, &THINK_OPEN) {
        let after_open = open.end();
        match first_tag(&text[after_open..], &THINK_CLOSE) {
            Some(close) => {
                text.replace_range(open.offset..after_open + close.end(), "");
            }
            None => text.truncate(open.offset),
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

pub async fn configured_models(preferences: &Settings) -> Result<Vec<String>> {
    models(&Endpoint::configured(&preferences.ai)?).await
}
pub async fn generate(preferences: &Settings, registry: &Registry, repo: &str) -> Result<Draft> {
    let endpoint = Endpoint::configured(&preferences.ai)?;
    let material = material(&registry.get(repo).await?.root).await?;
    let instructions = Instructions {
        model: &preferences.ai.model,
        template: &preferences.ai.prompt,
    };
    draft(&endpoint, instructions, material).await
}
pub struct Instructions<'a> {
    pub model: &'a str,
    pub template: &'a str,
}
pub async fn draft(
    endpoint: &Endpoint,
    instructions: Instructions<'_>,
    material: Material,
) -> Result<Draft> {
    let Instructions { model, template } = instructions;
    if model.trim().is_empty() {
        return Err(Error::refused("No model is configured"));
    }
    let client = client(endpoint)?;
    let prompt = prompt(template, &material);
    let completion: Completion = loop {
        let tier = current_tier();
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
            Err(error) => remember_tier(tier_after_rejection(tier, error)?),
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
