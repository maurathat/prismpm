//! HO-50: the binary application profile, `prismpm/binary-application/1`,
//! projected as `prismpm/model-document/9` (#630), from source-owned LexLean
//! declarations through the pinned lexlean compiler, in process.

use lexlean::{CheckRequest, Engine, LockRequest, Selection};
use prismpm::controller::BuildRequest;
use prismpm::holo::binary_application::BinaryApplication;
use prismpm::holo::model_document::{Application, ModelDocument};
use serde_json::Value;
use std::path::{Path, PathBuf};

const MODEL: &str = "Foundation.Binary.Application.V1.Model";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

/// A checked snapshot of a one-module project whose module is `source`, beside
/// the binary application model and Foundation.Bytes, on the text fixture's pins.
fn snapshot(source: &str) -> (tempfile::TempDir, lexlean::SemanticSnapshot) {
    let temp = tempfile::tempdir().unwrap();
    let repo = root();
    let project = repo.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lexlean.lock",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
    ] {
        let text = std::fs::read_to_string(project.join(name))
            .unwrap()
            .replace("PrismTextRequest", "BinaryProbe")
            .replace("TextRequest.lex.tex", "BinaryProbe.lex.tex");
        std::fs::write(temp.path().join(name), text).unwrap();
    }
    for module in ["Foundation/Bytes", "Foundation/Binary/Application/V1/Model"] {
        let path = temp.path().join("src").join(format!("{module}.lex.tex"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::copy(
            repo.join("stdlib/src").join(format!("{module}.lex.tex")),
            path,
        )
        .unwrap();
    }
    std::fs::write(temp.path().join("src/BinaryProbe.lex.tex"), source).unwrap();
    let language = repo.join("language/prism.arch");
    for entry in walkdir::WalkDir::new(&language) {
        let entry = entry.unwrap();
        let destination = temp
            .path()
            .join("language/prism.arch")
            .join(entry.path().strip_prefix(&language).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let manifest = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&manifest)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    let snapshot = Engine::load(&manifest)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    (temp, snapshot)
}

/// The LexLean notation of one byte string.
fn octets(bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("0x{hex}")
}

/// The LexLean notation of a list of byte strings.
fn byte_list(rows: &[Vec<u8>]) -> String {
    rows.iter()
        .rev()
        .fold("(nil Bytes)".to_owned(), |tail, row| {
            format!("(cons {} {tail})", octets(row))
        })
}

type Vector = (Vec<u8>, Vec<Vec<u8>>, Vec<u8>);
type Step = (Vec<u8>, Vec<Vec<u8>>, Vec<Vec<u8>>);

/// The knobs of a declaration: its contract, its bounds and its acceptance.
struct Declaration {
    contract: &'static str,
    request: u32,
    inputs: (u32, u32, u32),
    pages: u32,
    session: Option<(u32, u32)>,
    vectors: Vec<Vector>,
    sessions: Vec<Vec<Step>>,
    carried: Vec<Vec<u8>>,
}

fn source(d: &Declaration) -> String {
    let session = match d.session {
        None => format!("(ctor {MODEL}::Session.none)"),
        Some((state, count)) => format!(
            "(ctor {MODEL}::Session.bounded (record {MODEL}::SessionBounds {{stateMaximum := ({state} : UInt32), responseCountMaximum := ({count} : UInt32)}}))"
        ),
    };
    let vectors = d.vectors.iter().rev().fold(
        format!("(nil {MODEL}::AcceptanceVector)"),
        |tail, (request, inputs, response)| {
            format!(
                "(cons (record {MODEL}::AcceptanceVector {{request := {}, inputs := {}, response := {}}}) {tail})",
                octets(request),
                byte_list(inputs),
                octets(response)
            )
        },
    );
    let sessions = d.sessions.iter().rev().fold(
        format!("(nil (List {MODEL}::AcceptanceStep))"),
        |tail, steps| {
            let steps = steps.iter().rev().fold(
                format!("(nil {MODEL}::AcceptanceStep)"),
                |tail, (request, inputs, responses)| {
                    format!(
                        "(cons (record {MODEL}::AcceptanceStep {{request := {}, inputs := {}, responses := {}}}) {tail})",
                        octets(request),
                        byte_list(inputs),
                        byte_list(responses)
                    )
                },
            );
            format!("(cons {steps} {tail})")
        },
    );
    let (count, one, total) = d.inputs;
    let body = format!(
        "(record {MODEL}::BinaryApplication {{profile := \"prismpm/binary-application/1\", name := \"Binary Probe\", cargoName := \"binary-probe\", cargoVersion := \"0.1.0\", cargoDescription := \"A binary application probe.\", cargoRepository := \"https://github.com/UOR-Foundation/PrismPM\", cargoHomepage := \"https://github.com/UOR-Foundation/PrismPM\", libraryRoots := (cons \"BinaryProbe.step\" (nil String)), entryRoot := \"BinaryProbe.step\", coreContract := \"{}\", requestMaximum := ({} : UInt32), responseMaximum := (16 : UInt32), inputCountMaximum := ({count} : UInt32), inputMaximum := ({one} : UInt32), inputTotalMaximum := ({total} : UInt32), coreMemoryPages := ({} : UInt32), coreStackBytes := (16384 : UInt32), session := {session}, acceptanceVectors := {vectors}, acceptanceSessions := {sessions}, acceptanceInputs := {}, capabilitiesEmpty := true, fatArchive := true, primaryLayer := (0 : UInt8), viewLayer := (1 : UInt8)}})",
        d.contract,
        d.request,
        d.pages,
        byte_list(&d.carried)
    );
    format!(
        "\\begin{{lexlean}}{{BinaryProbe}}\n\\useglossary{{lexlean.std.bool@1.2.0}}\n\\useglossary{{lexlean.std.nat@1.2.0}}\n\\useglossary{{prism.arch@1.0.0}}\n\\importmodule{{Foundation.Bytes}}\n\\importmodule{{{MODEL}}}\n\\title{{Binary application model}}\n\\begin{{semanticmodule}}\ndefinition{{\n  name: application,\n  parameters: [],\n  result: {MODEL}::BinaryApplication,\n  body: {body}\n}}\n\ndefinition{{\n  name: step,\n  parameters: [turn : Bytes],\n  result: Bytes,\n  body: turn,\n  axioms: []\n}}\n\\end{{semanticmodule}}\n\\end{{lexlean}}\n"
    )
}

#[allow(clippy::result_large_err)]
fn project(d: &Declaration) -> Result<ModelDocument, prismpm::PrismError> {
    let (_project, snapshot) = snapshot(&source(d));
    prismpm::holo::application::project_application(&snapshot).map(Option::unwrap)
}

fn digest(bytes: &[u8]) -> Vec<u8> {
    blake3::hash(bytes).as_bytes().to_vec()
}

/// A dot product of two signed byte vectors named by digest: [1, 2, 3] . [4, 5, 6] = 32.
fn dot() -> Declaration {
    let (x, y) = (vec![1u8, 2, 3], vec![4u8, 5, 6]);
    Declaration {
        contract: "hologram:guest/core-wasm@1",
        request: 64,
        inputs: (2, 4096, 8192),
        pages: 2,
        session: None,
        vectors: vec![(Vec::new(), vec![digest(&x), digest(&y)], vec![0, 0, 0, 32])],
        sessions: Vec::new(),
        carried: vec![x, y],
    }
}

/// A counter kept across the steps of a session: each step answers the new count.
fn counter() -> Declaration {
    Declaration {
        contract: "hologram:guest/core-wasm@2",
        request: 64,
        inputs: (0, 0, 0),
        pages: 2,
        session: Some((8, 1)),
        vectors: Vec::new(),
        sessions: vec![vec![
            (Vec::new(), Vec::new(), vec![vec![0, 0, 0, 1]]),
            (Vec::new(), Vec::new(), vec![vec![0, 0, 0, 2]]),
        ]],
        carried: Vec::new(),
    }
}

fn binary(document: &ModelDocument) -> &BinaryApplication {
    match document.application.as_ref().unwrap() {
        Application::Binary(value) => value,
        _ => panic!("not a binary application"),
    }
}

fn pp2027(d: &Declaration) -> String {
    let error = project(d).expect_err("the declaration is refused");
    assert_eq!(error.code, "PP2027", "{}", error.message);
    error.message
}

#[test]
fn a_stateless_application_projects_with_its_vectors_and_inputs() {
    let document = project(&dot()).unwrap();
    assert_eq!(document.schema, "prismpm/model-document/9");
    let application = binary(&document);
    assert_eq!(application.core_contract, "hologram:guest/core-wasm@1");
    assert_eq!(application.session, None);
    assert_eq!(application.acceptance_vectors.len(), 1);
    assert_eq!(
        application.acceptance_vectors[0].inputs,
        vec![digest(&[1, 2, 3]), digest(&[4, 5, 6])]
    );
    assert_eq!(
        application.acceptance_inputs,
        vec![vec![1, 2, 3], vec![4, 5, 6]]
    );
    assert_eq!(application.resolved_frame_maximum(), 4 + 2 * 36 + 8192 + 64);
}

#[test]
fn a_session_application_projects_with_its_bounds_and_sessions() {
    let document = project(&counter()).unwrap();
    let application = binary(&document);
    assert_eq!(application.core_contract, "hologram:guest/core-wasm@2");
    let bounds = application.session.as_ref().unwrap();
    assert_eq!(
        (bounds.state_maximum, bounds.response_count_maximum),
        (8, 1)
    );
    assert_eq!(application.acceptance_sessions.len(), 1);
    assert_eq!(
        application.acceptance_sessions[0][1].responses,
        vec![vec![0, 0, 0, 2]]
    );
    let spec = application
        .session_spec("counter-core-wasm", "step", &"0".repeat(64))
        .unwrap();
    assert!(!spec.checkpoint);
    assert_eq!(spec.bounds_problem(), None);
    let mut checkpoint = counter();
    checkpoint.contract = "hologram:guest/core-wasm@3";
    let document = project(&checkpoint).unwrap();
    let spec = binary(&document)
        .session_spec("counter-core-wasm", "step", &"0".repeat(64))
        .unwrap();
    assert!(spec.checkpoint);
}

#[test]
fn a_session_member_that_disagrees_with_the_contract_is_pp2027() {
    // A stateless dot product whose acceptance is right but which declares
    // session bounds: only the session-member rule refuses it.
    let mut stateless_with_bounds = dot();
    stateless_with_bounds.session = Some((8, 1));
    assert!(pp2027(&stateless_with_bounds).contains("its session member must be none"));
    // A session-world counter whose acceptance is right but which declares no bounds.
    let mut session_without_bounds = counter();
    session_without_bounds.session = None;
    assert!(pp2027(&session_without_bounds).contains("declares no session bounds"));
    let mut session_with_vectors = dot();
    session_with_vectors.contract = "hologram:guest/core-wasm@2";
    session_with_vectors.session = Some((8, 1));
    assert!(pp2027(&session_with_vectors).contains("sessions"));
}

#[test]
fn a_frame_over_the_declared_memory_is_pp2027() {
    let mut big = counter();
    big.request = 1024 * 1024;
    assert!(pp2027(&big).contains("fit"));
    let mut big = dot();
    big.pages = 1;
    big.inputs = (2, 65_536, 131_072);
    assert!(pp2027(&big).contains("declared memory"));
}

#[test]
fn an_input_the_acceptance_does_not_carry_is_pp2027() {
    let mut missing = dot();
    missing.carried.pop();
    assert!(pp2027(&missing).contains("does not carry"));
    let mut flipped = dot();
    flipped.carried[0][0] ^= 1;
    assert!(pp2027(&flipped).contains("does not carry"));
}

#[test]
fn the_projection_is_valid_against_model_document_9() {
    let schema: Value = serde_json::from_slice(include_bytes!(
        "../../../schemas/model-document-v9.schema.json"
    ))
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    for declaration in [dot(), counter()] {
        let document = serde_json::to_value(project(&declaration).unwrap()).unwrap();
        let errors: Vec<String> = validator
            .iter_errors(&document)
            .map(|error| error.to_string())
            .collect();
        assert!(errors.is_empty(), "{errors:?}");
        // The projection round-trips through the closed model document.
        let typed: ModelDocument = serde_json::from_value(document).unwrap();
        prismpm::holo::validate::validate(&typed).unwrap();
    }
}

/// Build `d` with `prismpm build` and return the project and the build directory.
fn build(d: &Declaration) -> (tempfile::TempDir, PathBuf) {
    let (project, _) = snapshot(&source(d));
    std::fs::write(
        project.path().join("prismpm.toml"),
        "spec = \"prismpm/project/1\"\nproject = \"BinaryProbe\"\nlexlean_project = \"lexlean.toml\"\nbuild_root = \".prism\"\n\n[limits]\nmax_holo_bytes = 16777216\nmax_entities = 100000\nmax_diagnostics = 256\n",
    )
    .unwrap();
    let build = prismpm::Controller::load(project.path())
        .unwrap()
        .build(BuildRequest { config_path: None })
        .expect("the binary application builds");
    let directory = project.path().join(".prism/build").join(&build.build_id);
    (project, directory)
}

fn read(path: PathBuf) -> Vec<u8> {
    std::fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// `prismpm build` composes a binary application in the session world: its
/// guest is the compiled session shim, checked against @2 and the declared
/// memory, its archive's wasm layer names @2 and is entered at holo_step, and
/// its View is static, with no browser adapter. Two builds give the same holo.
#[test]
fn a_session_application_is_built_into_a_holo_of_the_session_world() {
    let (_first, directory) = build(&counter());
    let wasm = read(directory.join("core-wasm/binary_probe_core_wasm.wasm"));
    prismpm::session_guest::validate_session_guest(&wasm, "hologram:guest/core-wasm@2", 2)
        .expect("the built guest is the session world at the declared maximum");
    let target: Value =
        serde_json::from_slice(&read(directory.join("application/target-profile.json"))).unwrap();
    assert_eq!(target["schema"], "prismpm/core-wasm-session-target/1");
    assert_eq!(target["state_maximum"], 8);
    let manifest: Value =
        serde_json::from_slice(&read(directory.join("application/holo-manifest.json"))).unwrap();
    assert_eq!(
        manifest["layers"][0]["contract"],
        "hologram:guest/core-wasm@2"
    );
    assert_eq!(manifest["layers"][0]["entry"], "holo_step");
    let provenance: Value =
        serde_json::from_slice(&read(directory.join("application/model-provenance.json"))).unwrap();
    assert_eq!(
        provenance["view_binding"]["browser_projection"]["tag"],
        "none"
    );
    let view = String::from_utf8(read(directory.join("view/hologram/index.html"))).unwrap();
    assert!(view.contains("hologram:guest/core-wasm@2") && !view.contains("<script"));
    assert!(!directory.join("view/browser-adapter").exists());
    assert!(!directory.join("view/browser/provenance.json").exists());
    let holo = read(directory.join("Binary Probe.holo"));
    let (_second, again) = build(&counter());
    assert_eq!(
        holo,
        read(again.join("Binary Probe.holo")),
        "the build is deterministic"
    );
}
