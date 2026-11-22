use super::*;

const IR: &str = "(module SessionFixture (def step ((turn Bytes)) Bytes turn))";
const DIGEST: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn module(ir: &str) -> Module {
    let (rest, module) = prod_ir::parser::parse_module(ir).expect("fixture IR parses");
    assert!(rest.trim().is_empty());
    module
}

fn spec() -> SessionGuestSpec {
    SessionGuestSpec {
        crate_name: "prism-session-fixture-core-wasm".to_owned(),
        entry: "step".to_owned(),
        request_maximum: 4096,
        state_maximum: 65_536,
        response_maximum: 1024,
        response_count_maximum: 16,
        maximum_pages: 64,
        stack_bytes: 65_536,
        input_ir_sha256: DIGEST.to_owned(),
        checkpoint: false,
    }
}

fn source_of(package: &GeneratedPackage) -> String {
    let file = package
        .files
        .iter()
        .find(|file| file.path == "src/lib.rs")
        .expect("the package has src/lib.rs");
    String::from_utf8(file.bytes.clone()).expect("UTF-8 source")
}

fn manifest_of(package: &GeneratedPackage) -> serde_json::Value {
    let file = package
        .files
        .iter()
        .find(|file| file.path == "generation-manifest.json")
        .expect("the package has a generation manifest");
    serde_json::from_slice(&file.bytes).expect("the manifest is JSON")
}

#[test]
fn the_package_is_a_function_of_the_bounds_and_the_ir() {
    let first = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let second = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    assert_eq!(first.files, second.files);
    let paths: Vec<_> = first.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            ".cargo/config.toml",
            "Cargo.lock",
            "Cargo.toml",
            "generation-manifest.json",
            "src/lib.rs"
        ]
    );
    let mut wider = spec();
    wider.state_maximum += 1;
    let third = generate_session_guest_package(&module(IR), &wider).expect("generates");
    assert_ne!(source_of(&first), source_of(&third));
}

#[test]
fn the_manifest_names_the_contract_the_schema_and_every_bound() {
    let package = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let manifest = manifest_of(&package);
    assert_eq!(manifest["schema"], TARGET_SCHEMA);
    assert_eq!(manifest["contract"], SESSION_CONTRACT);
    assert_eq!(manifest["entry"], "step");
    assert_eq!(manifest["request_maximum"], 4096);
    assert_eq!(manifest["state_maximum"], 65_536);
    assert_eq!(manifest["response_maximum"], 1024);
    assert_eq!(manifest["response_count_maximum"], 16);
    assert_eq!(manifest["maximum_pages"], 64);
    assert_eq!(manifest["stack_bytes"], 65_536);
    let records = manifest["files"].as_array().expect("files");
    assert_eq!(records.len(), 4);
    for record in records {
        let path = record["path"].as_str().expect("path");
        let file = package
            .files
            .iter()
            .find(|file| file.path == path)
            .expect("listed file exists");
        assert_eq!(record["sha256"], sha256(&file.bytes));
    }
}

#[test]
fn the_shim_exports_the_session_world_and_never_holo_run() {
    let source =
        source_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    assert!(source.contains("pub extern \"C\" fn holo_alloc(size: i32) -> i32"));
    assert!(
        source.contains("pub extern \"C\" fn holo_step(request_ptr: i32, request_len: i32) -> i64")
    );
    assert!(!source.contains("holo_run"));
    assert!(source.contains("let answer: alloc::vec::Vec<u8> = crate::step(turn);"));
    for token in [
        "@RUNTIME_MODULE@",
        "@REQUEST_MAXIMUM@",
        "@STATE_MAXIMUM@",
        "@RESPONSE_MAXIMUM@",
        "@RESPONSE_COUNT_MAXIMUM@",
        "@MAXIMUM_PAGES@",
        "@INVOKE_ENTRY@",
    ] {
        assert!(
            !source.contains(token),
            "the template token {token} is replaced"
        );
    }
}

#[test]
fn the_shim_checks_every_declared_bound_of_the_answer_and_the_request() {
    let source =
        source_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    for line in [
        "const REQUEST_MAXIMUM: u32 = 4096;",
        "const STATE_MAXIMUM: u32 = 65536;",
        "const RESPONSE_MAXIMUM: u32 = 1024;",
        "const RESPONSE_COUNT_MAXIMUM: u32 = 16;",
        "const MAXIMUM_PAGES: u32 = 64;",
        "if size > REQUEST_MAXIMUM { trap(); }",
        "if next_state_len > STATE_MAXIMUM { trap(); }",
        "if count > RESPONSE_COUNT_MAXIMUM { trap(); }",
        "if length > RESPONSE_MAXIMUM { trap(); }",
        "if cursor != answer.len() { trap(); }",
        "if request_ptr != REQUEST_AT.load(Ordering::Relaxed) || request_len > REQUEST_CAPACITY.load(Ordering::Relaxed) { trap(); }",
    ] {
        assert!(source.contains(line), "the shim lacks `{line}`");
    }
}

#[test]
fn the_runtime_module_never_collides_with_a_model_name() {
    let ir = "(module SessionFixture (def __prism_session_runtime ((turn Bytes)) Bytes turn) (def step ((turn Bytes)) Bytes turn))";
    let source =
        source_of(&generate_session_guest_package(&module(ir), &spec()).expect("generates"));
    assert!(source.contains("mod __prism_session_runtime_1 {"));
}

#[test]
fn the_cargo_configuration_bounds_memory_and_the_stack() {
    let package = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let config = package
        .files
        .iter()
        .find(|file| file.path == ".cargo/config.toml")
        .expect("config");
    let config = String::from_utf8(config.bytes.clone()).expect("UTF-8");
    assert!(config.contains("link-arg=--max-memory=4194304"));
    assert!(config.contains("link-arg=-zstack-size=65536"));
    // The world has exactly three exports, so the stack bounds are linked, not exported.
    assert!(!config.contains("--export=__stack"));
}

#[test]
fn an_entry_that_is_missing_or_not_bytes_to_bytes_is_refused() {
    let mut missing = spec();
    missing.entry = "absent".to_owned();
    let error = generate_session_guest_package(&module(IR), &missing).expect_err("refused");
    assert_eq!(error.code, "PP5101");
    let typed = "(module SessionFixture (def step ((n Nat)) Nat n))";
    let error = generate_session_guest_package(&module(typed), &spec()).expect_err("refused");
    assert_eq!(error.code, "PP5101");
    assert!(error.message.contains("Bytes -> Bytes"));
}

#[test]
fn a_malformed_name_or_digest_is_refused() {
    for edit in [
        |s: &mut SessionGuestSpec| s.crate_name = "Upper".to_owned(),
        |s: &mut SessionGuestSpec| s.entry = "9step".to_owned(),
        |s: &mut SessionGuestSpec| s.input_ir_sha256 = "A".repeat(64),
        |s: &mut SessionGuestSpec| s.input_ir_sha256 = "0".repeat(63),
    ] {
        let mut bad = spec();
        edit(&mut bad);
        let error = generate_session_guest_package(&module(IR), &bad).expect_err("refused");
        assert_eq!(error.code, "PP5101");
    }
}

#[test]
fn every_bound_that_cannot_be_generated_is_refused_by_name() {
    type Edit = fn(&mut SessionGuestSpec);
    let cases: [(Edit, &str); 10] = [
        (|s| s.maximum_pages = 0, "pages"),
        (|s| s.maximum_pages = 32_768, "pages"),
        (|s| s.stack_bytes = 8, "stack"),
        (|s| s.stack_bytes = 64 * 65_536, "stack"),
        (|s| s.request_maximum = 0, "positive"),
        (|s| s.response_maximum = 0, "positive"),
        (|s| s.response_count_maximum = 0, "response count"),
        (
            |s| s.response_count_maximum = RESPONSE_COUNT_LIMIT + 1,
            "response count",
        ),
        (
            |s| {
                s.state_maximum = u32::MAX;
                s.maximum_pages = 32_767;
            },
            "32-bit",
        ),
        // Two copies of a 2 MiB state alone fill the 4 MiB the 64 pages declare.
        (|s| s.state_maximum = 2 * 1024 * 1024, "memory"),
    ];
    for (edit, word) in cases {
        let mut bad = spec();
        edit(&mut bad);
        let problem = bad.bounds_problem().expect("the bound is refused");
        assert!(problem.contains(word), "`{problem}` does not name {word}");
        let error = generate_session_guest_package(&module(IR), &bad).expect_err("refused");
        assert_eq!(error.code, "PP5101");
    }
    assert_eq!(spec().bounds_problem(), None);
}

#[test]
fn the_turn_and_answer_maxima_follow_the_frames() {
    let s = spec();
    assert_eq!(s.turn_maximum(), 4 + 65_536 + 4096);
    assert_eq!(s.answer_maximum(), 8 + 65_536 + 16 * (4 + 1024));
}

/// The bounds both ABI probes are generated with; `checkpoint` picks the world.
fn probe_bounds(crate_name: &str, checkpoint: bool) -> SessionGuestSpec {
    SessionGuestSpec {
        crate_name: crate_name.to_owned(),
        entry: "step".to_owned(),
        request_maximum: 64,
        state_maximum: 256,
        response_maximum: 256,
        response_count_maximum: 4,
        maximum_pages: 2,
        stack_bytes: 16_384,
        input_ir_sha256: DIGEST.to_owned(),
        checkpoint,
    }
}

/// A committed probe under sdk/npm/prism-code/test/fixtures is exactly the
/// generator's shim around its test entry, with the generator's Cargo files.
fn assert_probe_is_generated(directory: &str, bounds: &SessionGuestSpec) {
    let probe = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../sdk/npm/prism-code/test/fixtures")
        .join(directory);
    let read = |path: &str| {
        std::fs::read_to_string(probe.join(path))
            .expect("the probe file is committed")
            .replace("\r\n", "\n")
    };
    assert_eq!(bounds.bounds_problem(), None);
    let expected = format!(
        "{CRATE_HEADER}\n{}\n\n{}",
        read("entry.rs"),
        render_runtime(bounds, "__prism_session_runtime", false)
    );
    assert_eq!(
        read("src/lib.rs"),
        expected,
        "regenerate the probe {directory} from the template"
    );
    let generated = generate_session_guest_package(&module(IR), bounds).expect("generates");
    for path in [".cargo/config.toml", "Cargo.toml"] {
        let file = generated
            .files
            .iter()
            .find(|file| file.path == path)
            .expect("generated");
        let mine = String::from_utf8(file.bytes.clone()).expect("UTF-8");
        assert_eq!(
            read(path),
            mine,
            "{path} of the probe {directory} differs from the generator's"
        );
    }
}

/// The runtime tests of prism-code run the real shim: the session ABI probe under
/// sdk/npm/prism-code/test/fixtures/session-probe is this template around a test
/// entry. Its committed source must be exactly what the generator renders.
#[test]
fn the_session_probe_is_the_generated_shim_around_its_test_entry() {
    assert_probe_is_generated(
        "session-probe",
        &probe_bounds("prism-session-probe-core-wasm", false),
    );
}

/// The checkpoint probe is the @3 shim around the same test entry, so the
/// runtime's checkpoint tests run the real `holo_state` and `holo_restore`.
#[test]
fn the_checkpoint_probe_is_the_generated_shim_around_the_same_entry() {
    assert_probe_is_generated(
        "checkpoint-probe",
        &probe_bounds("prism-checkpoint-probe-core-wasm", true),
    );
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../sdk/npm/prism-code/test/fixtures");
    let entry = |directory: &str| {
        std::fs::read_to_string(fixtures.join(directory).join("entry.rs"))
            .expect("the probe entry is committed")
            .replace("\r\n", "\n")
    };
    assert_eq!(entry("checkpoint-probe"), entry("session-probe"));
}

fn checkpoint_spec() -> SessionGuestSpec {
    SessionGuestSpec {
        checkpoint: true,
        ..spec()
    }
}

#[test]
fn the_checkpoint_package_is_the_session_package_with_two_more_exports() {
    let session =
        source_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    let checkpoint = source_of(
        &generate_session_guest_package(&module(IR), &checkpoint_spec()).expect("generates"),
    );
    // The @3 source is the @2 source with exactly one block added before the panic handler.
    let block = format!("{CHECKPOINT_TEMPLATE}\n");
    let at = session
        .find("#[panic_handler]")
        .expect("the shim has a panic handler");
    assert_eq!(
        checkpoint,
        format!("{}{block}{}", &session[..at], &session[at..])
    );
    assert!(checkpoint.contains("pub extern \"C\" fn holo_state() -> i64"));
    assert!(checkpoint.contains("pub extern \"C\" fn holo_restore(size: i32) -> i32"));
    for line in [
        "if size > STATE_MAXIMUM { trap(); }",
        "if NEXT.load(Ordering::Relaxed) != 0 || STATE_LENGTH.load(Ordering::Relaxed) != 0 { trap(); }",
    ] {
        assert!(checkpoint.contains(line), "the checkpoint shim lacks `{line}`");
    }
    assert!(!checkpoint.contains("holo_run"));
    assert_eq!(checkpoint_spec().bounds_problem(), None);
}

#[test]
fn the_checkpoint_manifest_names_the_checkpoint_contract() {
    let session =
        manifest_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    let checkpoint = manifest_of(
        &generate_session_guest_package(&module(IR), &checkpoint_spec()).expect("generates"),
    );
    assert_eq!(session["contract"], SESSION_CONTRACT);
    assert_eq!(checkpoint["contract"], CHECKPOINT_CONTRACT);
    assert_eq!(checkpoint["schema"], TARGET_SCHEMA);
    for bound in [
        "request_maximum",
        "state_maximum",
        "response_maximum",
        "response_count_maximum",
        "maximum_pages",
        "stack_bytes",
    ] {
        assert_eq!(session[bound], checkpoint[bound], "{bound}");
    }
}

/// The @2 package must not move: its probe, the committed shim, still equals the
/// generator's output, and the template a @2 shim is rendered from is the file.
#[test]
fn the_session_package_is_unchanged_when_checkpoints_are_off() {
    let source = render_runtime(&spec(), "__prism_session_runtime", false);
    assert!(!source.contains("holo_state"));
    assert!(!source.contains("holo_restore"));
    let template_lines = RUNTIME_TEMPLATE.lines().count();
    assert_eq!(source.lines().count(), template_lines);
    assert_probe_is_generated(
        "session-probe",
        &probe_bounds("prism-session-probe-core-wasm", false),
    );
}

/// The committed probes are the generated shims compiled: each validates as its
/// own world at its declared maximum, and every planted disagreement is refused.
#[test]
fn a_compiled_session_guest_is_checked_against_its_world_and_memory() {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../sdk/npm/prism-code/test/fixtures");
    let probe = |directory: &str| {
        std::fs::read(fixtures.join(directory).join("probe.wasm")).expect("the probe is committed")
    };
    let session = probe("session-probe");
    let checkpoint = probe("checkpoint-probe");
    let pages = probe_bounds("unused", false).maximum_pages;
    validate_session_guest(&session, SESSION_CONTRACT, pages).expect("the session probe is @2");
    validate_session_guest(&checkpoint, CHECKPOINT_CONTRACT, pages)
        .expect("the checkpoint probe is @3");
    for (wasm, contract, maximum) in [
        (&session, CHECKPOINT_CONTRACT, pages),
        (&checkpoint, SESSION_CONTRACT, pages),
        (&session, SESSION_CONTRACT, pages + 1),
        (&session, "hologram:guest/core-wasm@1", pages),
    ] {
        assert_eq!(
            validate_session_guest(wasm, contract, maximum)
                .expect_err("a disagreement is refused")
                .code,
            "PP5103"
        );
    }
    let mut truncated = session.clone();
    truncated.truncate(session.len() - 1);
    assert!(validate_session_guest(&truncated, SESSION_CONTRACT, pages).is_err());
}
