//! HO-50: the binary application profile, `prismpm/binary-application/1`
//! projected as `prismpm/model-document/9` (#630). The owning suite is the
//! projection's own tests in `prismpm::holo::binary_application`.

use std::path::Path;
use std::process::Command;

pub(super) fn verify(root: &Path) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--test",
            "binary_application",
        ])
        .args(["--", "--nocapture", "--test-threads=1"])
        // A target disjoint from the outer conformance Cargo owner's lock.
        .env("CARGO_TARGET_DIR", root.join("target/conformance-nested"))
        .output()
        .expect("the owning suite executes");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "HO-50: {stdout}\n{stderr}");
    for test in [
        "a_stateless_application_projects_with_its_vectors_and_inputs",
        "a_session_application_projects_with_its_bounds_and_sessions",
        "a_session_member_that_disagrees_with_the_contract_is_pp2027",
        "a_frame_over_the_declared_memory_is_pp2027",
        "an_input_the_acceptance_does_not_carry_is_pp2027",
        "the_projection_is_valid_against_model_document_9",
        "a_session_application_is_built_into_a_holo_of_the_session_world",
    ] {
        assert!(
            stdout.contains(&format!("{test} ... ok")),
            "HO-50 requires the passing owning test {test}"
        );
    }
}
