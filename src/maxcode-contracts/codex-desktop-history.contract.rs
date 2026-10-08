use super::*;

#[test]
fn desktop_attachments_keep_local_projection_and_plain_text() {
    let raw="\n# Files mentioned by the user:\n\n## report.pdf: /workspace/a #1.pdf\n\n## My request:\nRead this\n";
    assert_eq!(
        codex_desktop_attachments::rewrite(raw).as_deref(),
        Some("[report.pdf](file:///workspace/a%20%231.pdf)\nRead this\n")
    );
    assert!(
        codex_desktop_attachments::rewrite("ordinary # Files mentioned by the user: prose")
            .is_none()
    );
}

#[test]
fn desktop_attachment_names_and_destinations_remain_single_markdown_links() {
    let raw = "# Files pasted by the user:\n\n## \"a [b]\\nc\": /w/a(1).txt\n\n## My request:\ngo";
    assert_eq!(
        codex_desktop_attachments::rewrite(raw).as_deref(),
        Some("[a \\[b\\] c](<file:///w/a(1).txt>)\ngo")
    );
}
