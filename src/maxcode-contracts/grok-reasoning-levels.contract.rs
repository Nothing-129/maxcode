use super::*;
/// The `reasoning_efforts` value of `[model.<id>]` in `merged`, as TOML text.
fn grok_efforts_text(merged: &str, id: &str) -> Option<String> {
    let doc = merged.parse::<toml_edit::Document>().unwrap();
    doc.get("model")?
        .as_table_like()?
        .get(id)?
        .as_table_like()?
        .get("reasoning_efforts")
        .map(|item| item.to_string().trim().to_string())
}

#[test]
fn parse_grok_settings_reads_reasoning_efforts_in_every_form() {
    // Bare strings, inline tables (their `value`, not their `id`) and mixed
    // case all read as the lowercased level Grok sends; an entry with no
    // readable level is skipped.
    let inline = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\
                      reasoning_efforts = [\"Low\", { id = \"deep\", value = \"high\", label = \"Deep\" }, \
                      { id = \"broken\" }, 7]\n";
    assert_eq!(
        parse_grok_settings(inline).custom_reasoning_efforts,
        vec!["low", "high"]
    );
    // An array of tables reads the same.
    let aot = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"medium\"\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"xhigh\"\ndefault = true\n";
    assert_eq!(
        parse_grok_settings(aot).custom_reasoning_efforts,
        vec!["medium", "xhigh"]
    );
    // Absent key, or a block that is not the managed model ⇒ nothing declared.
    for body in [
        "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n",
        "[models]\ndefault = \"grok-4.5\"\n\n[model.foo]\nreasoning_efforts = [\"low\"]\n",
    ] {
        let levels = parse_grok_settings(body).custom_reasoning_efforts;
        assert!(levels.is_empty(), "{body}");
    }
}

#[test]
fn apply_grok_reasoning_efforts_writes_bare_levels_and_round_trips() {
    let merged = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            custom_model_id: Some("grok-4.7".into()),
            custom_reasoning_efforts: Some(vec![
                "low".into(),
                "medium".into(),
                " High ".into(),
                "xhigh".into(),
                "".into(),
            ]),
            ..Default::default()
        },
    )
    .unwrap();
    // The shape verified against grok 1.0.62: bare levels make it advertise
    // `supportsReasoningEffort` with exactly these `reasoningEfforts`.
    assert_eq!(
        grok_efforts_text(&merged, "grok-4.7").as_deref(),
        Some("[\"low\", \"medium\", \"high\", \"xhigh\"]")
    );
    assert_eq!(
        parse_grok_settings(&merged).custom_reasoning_efforts,
        vec!["low", "medium", "high", "xhigh"]
    );
}

#[test]
fn apply_grok_reasoning_efforts_none_leaves_a_hand_written_list() {
    // No levels sent — the panel's chips were untouched, or the client
    // predates the field: the hand-written list must survive, even though
    // every other field is managed.
    let base = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\
                    reasoning_efforts = [{ id = \"deep\", value = \"high\", label = \"Deep\" }]\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            custom_model_id: Some("foo".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(merged
        .contains("reasoning_efforts = [{ id = \"deep\", value = \"high\", label = \"Deep\" }]"));
}

#[test]
fn apply_grok_reasoning_efforts_unchanged_list_is_left_as_written() {
    // Saving other fields sends the levels the panel read back. Matching the
    // file (case-insensitively, skipping unreadable entries) leaves the
    // user's layout, comments and extra fields alone — in both TOML forms.
    let inline = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\
                      reasoning_efforts = [\n  \"Low\", # cheap\n  { value = \"high\", default = true },\n  { id = \"broken\" },\n]\n";
    let aot = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"low\" # cheap\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"high\"\ndefault = true\n";
    for base in [inline, aot] {
        let merged = apply_grok_structured_config(
            base,
            &GrokStructuredConfig {
                custom_model_id: Some("foo".into()),
                custom_base_url: Some("https://gw/v1".into()),
                custom_reasoning_efforts: Some(vec!["low".into(), "high".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        // Untouched: the comment and the per-entry default are still there.
        assert!(merged.contains("# cheap"), "{merged}");
        assert!(merged.contains("default = true"), "{merged}");
        assert_eq!(
            parse_grok_settings(&merged).custom_base_url.as_deref(),
            Some("https://gw/v1")
        );
    }
}

#[test]
fn apply_grok_reasoning_efforts_change_keeps_the_entries_still_listed() {
    // A changed list keeps each surviving level's own entry (its id, label
    // and default stay), adds new levels as bare strings, drops the removed
    // ones — including an AoT, which becomes one inline array.
    let inline = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\
                      reasoning_efforts = [\"low\", { id = \"deep\", value = \"high\", label = \"Deep\" }, \"xhigh\"]\n";
    let aot = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"low\"\n\n\
                   [[model.foo.reasoning_efforts]]\nid = \"deep\"\nvalue = \"high\"\nlabel = \"Deep\"\n\n\
                   [[model.foo.reasoning_efforts]]\nvalue = \"xhigh\"\n";
    for (base, kept_low) in [(inline, "\"low\""), (aot, "{ value = \"low\" }")] {
        let merged = apply_grok_structured_config(
            base,
            &GrokStructuredConfig {
                custom_model_id: Some("foo".into()),
                custom_reasoning_efforts: Some(vec!["low".into(), "medium".into(), "high".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            grok_efforts_text(&merged, "foo"),
            Some(format!(
                "[{kept_low}, \"medium\", {{ id = \"deep\", value = \"high\", label = \"Deep\" }}]"
            )),
            "{merged}"
        );
        assert!(!merged.contains("[[model.foo.reasoning_efforts]]"));
        assert_eq!(
            parse_grok_settings(&merged).custom_reasoning_efforts,
            vec!["low", "medium", "high"]
        );
    }
}

#[test]
fn apply_grok_reasoning_efforts_empty_hands_levels_back_to_the_endpoint() {
    let base = "[models]\ndefault = \"foo\"\n\n[model.foo]\nmodel = \"foo\"\n\
                    reasoning_efforts = [\"low\", \"high\"]\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            custom_model_id: Some("foo".into()),
            custom_reasoning_efforts: Some(vec!["  ".into()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!merged.contains("reasoning_efforts"), "{merged}");
    assert_eq!(
        parse_grok_settings(&merged).custom_model_id.as_deref(),
        Some("foo")
    );
}

#[test]
fn apply_grok_reasoning_efforts_follow_a_rename() {
    // A rename starts a fresh block; the levels the panel holds land in it.
    let base = "[models]\ndefault = \"old\"\n\n[model.old]\nmodel = \"old\"\n\
                    reasoning_efforts = [\"low\", \"high\"]\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            custom_model_id: Some("new".into()),
            custom_reasoning_efforts: Some(vec!["low".into(), "high".into()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!merged.contains("old"), "{merged}");
    let back = parse_grok_settings(&merged);
    assert_eq!(back.custom_model_id.as_deref(), Some("new"));
    assert_eq!(back.custom_reasoning_efforts, vec!["low", "high"]);
}

#[test]
fn apply_grok_reasoning_efforts_left_alone_move_with_a_rename() {
    // The panel sends no levels while its chips are untouched; a rename must
    // not drop the list with the old block. An array of tables arrives as
    // one inline array, and a block renamed onto keeps a list of its own.
    let rename = |base: &str| {
        apply_grok_structured_config(
            base,
            &GrokStructuredConfig {
                custom_model_id: Some("new".into()),
                ..Default::default()
            },
        )
        .unwrap()
    };
    let inline = rename(
        "[models]\ndefault = \"old\"\n\n[model.old]\nmodel = \"old\"\n\
             reasoning_efforts = [\"low\", { id = \"deep\", value = \"high\" }]\n",
    );
    assert!(!inline.contains("old"), "{inline}");
    assert_eq!(
        grok_efforts_text(&inline, "new").as_deref(),
        Some("[\"low\", { id = \"deep\", value = \"high\" }]")
    );

    let aot = rename(
        "[models]\ndefault = \"old\"\n\n[model.old]\nmodel = \"old\"\n\n\
             [[model.old.reasoning_efforts]]\nvalue = \"low\"\n\n\
             [[model.old.reasoning_efforts]]\nvalue = \"xhigh\"\ndefault = true\n",
    );
    assert!(!aot.contains("[[model."), "{aot}");
    assert_eq!(
        grok_efforts_text(&aot, "new").as_deref(),
        Some("[{ value = \"low\" }, { value = \"xhigh\", default = true }]")
    );
    assert_eq!(
        parse_grok_settings(&aot).custom_reasoning_efforts,
        vec!["low", "xhigh"]
    );

    let onto = rename(
        "[models]\ndefault = \"old\"\n\n[model.old]\nreasoning_efforts = [\"low\"]\n\n\
             [model.new]\nreasoning_efforts = [\"max\"]\n",
    );
    assert_eq!(
        parse_grok_settings(&onto).custom_reasoning_efforts,
        vec!["max"]
    );
}
