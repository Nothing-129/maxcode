//! Capture file links while publishing on the machine that owns the transcript.
//! Public snapshot reads never resolve paths or access the workspace.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

use crate::commands::folders::{read_workspace_file_base64, FILE_BASE64_MAX_BYTES};
use crate::models::{ContentBlock, MessageTurn};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SharedFile {
    pub name: String,
    pub data: Option<String>,
}

fn local_path(destination: &str) -> Option<PathBuf> {
    if destination.starts_with("file:") {
        return url::Url::parse(destination).ok()?.to_file_path().ok();
    }
    let path = destination
        .strip_prefix("codeg://file/")
        .unwrap_or_else(|| destination.split(['#', '?']).next().unwrap_or_default());
    if path.is_empty()
        || path.starts_with(['#', '?'])
        || path.starts_with("//")
        || (!Path::new(path).is_absolute() && url::Url::parse(path).is_ok())
    {
        return None;
    }
    Some(PathBuf::from(urlencoding::decode(path).ok()?.as_ref()))
}

struct FileCollector<'a> {
    workspace: &'a Path,
    uploads: PathBuf,
    codex_attachments: PathBuf,
    indices: HashMap<PathBuf, usize>,
    files: Vec<SharedFile>,
    remaining: usize,
}

impl FileCollector<'_> {
    async fn capture(&mut self, path: PathBuf) -> Option<usize> {
        let target = self.workspace.join(path);
        let name = target.file_name()?.to_str()?.to_owned();
        if let Some(index) = self.indices.get(&target) {
            return Some(*index);
        }
        let mut data = None;
        for root in [self.workspace, &self.uploads, &self.codex_attachments] {
            if let Ok(relative) = target.strip_prefix(root) {
                data = read_workspace_file_base64(
                    root.to_string_lossy().into_owned(),
                    relative.to_string_lossy().into_owned(),
                    Some(self.remaining),
                )
                .await
                .ok();
                // The shared reader has a minimum read limit. Enforce the exact
                // remaining snapshot budget even for its final small file.
                if let Some(encoded) = &data {
                    let size = encoded.len() / 4 * 3
                        - (encoded.len() - encoded.trim_end_matches('=').len());
                    if size <= self.remaining {
                        self.remaining -= size;
                    } else {
                        data = None;
                    }
                }
                break;
            }
        }
        let index = self.files.len();
        self.indices.insert(target, index);
        self.files.push(SharedFile { name, data });
        Some(index)
    }

    async fn rewrite(&mut self, source: &str) -> String {
        let mut output = String::new();
        let mut cursor = 0;
        // A link can wrap an image pointing to a different file (thumbnail
        // linked to the actual deliverable). Keep both as separate controls.
        let mut references = Vec::new();
        for (event, span) in Parser::new(source).into_offset_iter() {
            match event {
                Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
                    references.push((dest_url, String::new(), String::new()));
                }
                Event::Text(text) | Event::Code(text) => {
                    if let Some((_, label, _)) = references.last_mut() {
                        label.push_str(&text);
                    }
                }
                Event::End(TagEnd::Link | TagEnd::Image) => {
                    let (destination, mut label, nested) = references.pop().unwrap();
                    let replacement = if let Some(path) = local_path(&destination) {
                        let Some(index) = self.capture(path).await else {
                            continue;
                        };
                        if label.is_empty() || label == destination.as_ref() {
                            label.clone_from(&self.files[index].name);
                        }
                        format!("{nested}{}", file_link(&label, index))
                    } else if nested.is_empty() {
                        source[span.clone()].to_string()
                    } else {
                        // Keep the original outer destination and title.
                        let Some(close) = source[span.clone()].rfind("](") else {
                            continue;
                        };
                        format!(
                            "{nested}[{}{}",
                            escape_label(&label),
                            &source[span.start + close..span.end]
                        )
                    };
                    if let Some((_, outer_label, images)) = references.last_mut() {
                        outer_label.push_str(&label);
                        images.push_str(&replacement);
                        images.push(' ');
                    } else {
                        output.push_str(&source[cursor..span.start]);
                        output.push_str(&replacement);
                        cursor = span.end;
                    }
                }
                _ => {}
            }
        }
        output.push_str(&source[cursor..]);
        output
    }
}

fn escape_label(label: &str) -> String {
    let mut escaped = String::new();
    for ch in label.chars() {
        if ch.is_ascii_punctuation() {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn file_link(label: &str, index: usize) -> String {
    format!("[{}](#maxcode-file-{index})", escape_label(label))
}

pub(super) async fn collect(turns: &mut [MessageTurn], workspace: &Path) -> Vec<SharedFile> {
    let mut collector = FileCollector {
        workspace,
        uploads: crate::paths::codeg_uploads_root(),
        codex_attachments: crate::parsers::codex::resolve_codex_home_dir().join("attachments"),
        indices: HashMap::new(),
        files: Vec::new(),
        remaining: FILE_BASE64_MAX_BYTES,
    };
    for turn in turns {
        let mut blocks = Vec::new();
        for mut block in std::mem::take(&mut turn.blocks) {
            // Sanitization promotes tool images and clears local URIs. Resolve
            // URI-only images here, before that irreversible projection.
            let mut image_paths = Vec::new();
            match &mut block {
                ContentBlock::Text { text } => *text = collector.rewrite(text).await,
                ContentBlock::Image {
                    data,
                    uri: Some(uri),
                    ..
                } if data.is_empty() => image_paths.push(uri.clone()),
                ContentBlock::ImageGeneration {
                    image: Some(image), ..
                } if image.data.is_empty() => {
                    image_paths.extend(image.uri.clone());
                }
                ContentBlock::ToolResult { images, .. } => {
                    images.retain(|image| {
                        if image.data.is_empty() {
                            image_paths.extend(image.uri.clone());
                            return false;
                        }
                        true
                    });
                }
                _ => {}
            }
            if image_paths.is_empty() || matches!(block, ContentBlock::ToolResult { .. }) {
                blocks.push(block);
            }
            for uri in image_paths {
                if let Some(path) = local_path(&uri) {
                    if let Some(index) = collector.capture(path).await {
                        blocks.push(ContentBlock::Text {
                            text: file_link(&collector.files[index].name, index),
                        });
                    }
                }
            }
        }
        turn.blocks = blocks;
    }
    collector.files
}
