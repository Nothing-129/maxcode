use super::*;
use std::cell::RefCell;
use std::collections::HashMap;

#[test]
fn imported_tokens_are_copied_once_and_signout_never_reads_codeg_again() {
    let data = tempfile::tempdir().unwrap();
    let store = RefCell::new(HashMap::from([
        (
            ("codeg".to_owned(), "github-token:alice".to_owned()),
            "old-alice".to_owned(),
        ),
        (
            ("maxcode".to_owned(), "github-token:bob".to_owned()),
            "new-bob".to_owned(),
        ),
        (
            ("codeg".to_owned(), "github-token:bob".to_owned()),
            "old-bob".to_owned(),
        ),
    ]));
    let keys = vec!["github-token:alice".into(), "github-token:bob".into()];
    copy_credentials_once(
        data.path(),
        &keys,
        |service, key| Ok(store.borrow().get(&(service.into(), key.into())).cloned()),
        |key, value| {
            store
                .borrow_mut()
                .insert(("maxcode".into(), key.into()), value.into());
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        store.borrow()[&("maxcode".into(), "github-token:alice".into())],
        "old-alice"
    );
    assert_eq!(
        store.borrow()[&("maxcode".into(), "github-token:bob".into())],
        "new-bob"
    );
    store
        .borrow_mut()
        .remove(&("maxcode".into(), "github-token:alice".into()));
    copy_credentials_once(
        data.path(),
        &keys,
        |_, _| panic!("must not read Codeg after initial import"),
        |_, _| panic!("must not restore a deleted token"),
    )
    .unwrap();
    assert_eq!(
        store.borrow()[&("codeg".into(), "github-token:alice".into())],
        "old-alice"
    );
}
