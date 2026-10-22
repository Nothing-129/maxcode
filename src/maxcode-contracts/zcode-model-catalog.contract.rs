use super::*;

const FIXTURE: &str = include_str!("fixtures/zcode-build-config-options.js.txt");

#[test]
fn zcode_uses_live_catalog_without_ghosts_or_aliases() {
    let source = patched_source(FIXTURE).unwrap().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let module = dir.path().join("catalog.mjs");
    // Execute the real reviewed upstream config-options function, with only its
    // I/O dependencies stubbed. No model call or installed bridge is required.
    let harness = r#"
import assert from 'node:assert/strict';
let snapshot;
let failRead = false;
const legacy = [
  {providerId:'builtin:bigmodel',modelId:'GLM-5.3'},
  {providerId:'builtin:bigmodel',modelId:'GLM-5.3-Flash'},
];
const loadAllModels = () => legacy;
const DEFAULT_MODEL_ID = 'GLM-5.3';
const DEFAULT_PROVIDER_ID = 'builtin:bigmodel';
const initialSessionMode = () => 'build';
const readConfig = () => ({});
const orderThoughtVariants = values => values.map(value => ({value,name:value}));
const configProviderIdFor = id => id.startsWith('account:') ? 'legacy-account-alias' : id;
const sessionRead = async () => { if (failRead) throw Error('offline'); return {settings:{model:snapshot}}; };
const formatModelValue = (p,m) => p+'\\'+m;
const buildModelSelectOptions = models => models.map(m => ({value:formatModelValue(m.providerId,m.modelId),name:m.modelId}));
const CONFIG_META = {mode:{name:'Mode',options:[]},thought:{name:'Thought',options:[]},model:{name:'Model'}};
const backendCapabilities = () => ({quota:false});
const server = {sessionPlanActive:new Set(),modelAvailability:new Map()};
const options = async sid => (await buildConfigOptions(server,sid))[0];
const ref = {providerId:'bigmodel-api',modelId:'GLM-5.3'};
// session/read contains only the active model; create/resume cached BOTH.
snapshot = {current:ref,available:[{ref,label:'GLM-5.3'}]};
const flash = {providerId:'bigmodel-api',modelId:'GLM-5.3-Flash'};
server.modelAvailability.set('test',[ref,flash]);
let model = await options('test');
assert.deepEqual(model.options.map(o=>o.value), ['bigmodel-api\\GLM-5.3','bigmodel-api\\GLM-5.3-Flash']);
assert.equal(model.currentValue,model.options[0].value);
// Switching current model must not shrink the catalog to that model.
snapshot = {current:flash,available:[{ref:flash}]};
model = await options('test');
assert.equal(model.currentValue,'bigmodel-api\\GLM-5.3-Flash');
assert.equal(model.options.length,2);
// A stale current model must not be reintroduced into an authoritative list.
snapshot.current = {providerId:'removed-provider',modelId:'deleted-model'};
assert.deepEqual((await options('test')).options.map(o=>o.value),['bigmodel-api\\GLM-5.3','bigmodel-api\\GLM-5.3-Flash']);
server.modelAvailability.set('test',[]);
snapshot.available = [];
assert.deepEqual((await options('test')).options,[]);
// Keep native account ids; do not restore custom provider alias normalization.
snapshot = {current:{providerId:'account:bigmodel-individual-coding-plan',modelId:'GLM-5.3'}};
snapshot.available = [{ref:snapshot.current}];
server.modelAvailability.set('test',[snapshot.current]);
model = await options('test');
assert.equal(model.currentValue,model.options[0].value);
assert.ok(model.currentValue.startsWith('account:'));
// Runtimes without availability, failed reads and lazy sessions keep fallback.
server.modelAvailability.delete('test');
snapshot = {current:ref};
assert.equal((await options('test')).options.length,3);
failRead = true;
assert.equal((await options('test')).options.length,2);
assert.equal((await options(null)).options.length,2);
"#;
    std::fs::write(&module, format!("{source}\n{harness}")).unwrap();
    let output = std::process::Command::new("node")
        .arg(module)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn zcode_catalog_repair_is_version_gated_and_idempotent() {
    for version in ["0.72.0", "0.76.1", "0.76.2", "0.77.0"] {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path().join("dist");
        std::fs::create_dir_all(dist.join("config")).unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            format!(r#"{{"name":"zcode-acp-server","version":"{version}"}}"#),
        )
        .unwrap();
        let file = dist.join("config/options.js");
        std::fs::write(&file, FIXTURE).unwrap();
        ensure(&dist.join("cli.js")).unwrap();
        let first = std::fs::read_to_string(&file).unwrap();
        assert_eq!(first.contains(MARKER), version != "0.77.0");
        ensure(&dist.join("cli.js")).unwrap();
        assert_eq!(first, std::fs::read_to_string(&file).unwrap());
    }
}

#[test]
fn zcode_catalog_repair_refuses_unreviewed_source() {
    assert!(patched_source("unrelated code").is_err());
    assert!(patched_source(&format!("{FIXTURE}\n{FIXTURE}")).is_err());
}
