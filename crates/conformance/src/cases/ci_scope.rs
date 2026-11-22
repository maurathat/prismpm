//! RP-13: SDK-owned executable classification fixtures. No fixture can be skipped.

use std::path::Path;
use std::process::Command;

pub(super) fn verify(root: &Path) {
    let interpreter = if cfg!(windows) { "python" } else { "python3" };
    let result = Command::new(interpreter)
        .args(["-m", "unittest", "discover", "-s", "sdk/ci", "-p", "test_passive_readme_scope.py", "-v"])
        .current_dir(root)
        .output()
        .expect("Python runtime required for portable SDK classifier conformance");
    let transcript = String::from_utf8_lossy(&result.stderr);
    const EXPECTED: &[&str] = &[
        "test_passes_two_regular_presentation_paths",
        "test_rejects_unapproved_png",
        "test_rejects_mixed_source_change",
        "test_rejects_workflow_change",
        "test_rejects_unknown_doc",
        "test_rejects_executable_readme",
        "test_rejects_symlink_readme",
        "test_rejects_broken_anchor",
        "test_rejects_broken_local_target",
        "test_rejects_reference_style_missing_file",
        "test_rejects_reference_style_broken_anchor",
        "test_rejects_reference_definition_without_usage",
        "test_rejects_empty_label_broken_link",
        "test_rejects_empty_alt_broken_image",
        "test_rejects_fenced_heading_as_fake_anchor",
        "test_rejects_unterminated_fence",
        "test_rejects_unparseable_markdown_nested_title",
        "test_rejects_unquoted_html_link_attribute",
        "test_rejects_hidden_html_comment_heading",
        "test_rejects_missing_cross_document_anchor",
        "test_rejects_gitlinks_hidden_by_repo_configuration",
        "test_rejects_replacement_object_spoof",
        "test_rejects_traversal",
        "test_rejects_generated_source_header",
        "test_rejects_modified_generated_region",
        "test_rejects_removed_protected_region",
        "test_rejects_uorust_release_target_change",
        "test_rejects_removed_uorust_release_target_markers",
        "test_rejects_unknown_generated_marker",
        "test_rejects_missing_base",
        "test_rejects_mismatched_head",
        "test_rejects_outdated_base_before_declaring_passive",
        "test_rejects_no_readme_change",
        "test_rejects_renamed_readme",
        "test_rejects_asset_alone_or_delete",
        "test_rejects_newly_injected_policy_marker",
    ];
    assert!(result.status.success(), "RP-13 refused:\n{transcript}");
    assert!(transcript.contains(&format!("Ran {} tests", EXPECTED.len())),
        "RP-13 fixture inventory incomplete:\n{transcript}");
    assert!(!transcript.contains("skipped") && !transcript.contains("expected failure"),
        "RP-13 must not accept skipped or suppressed cases:\n{transcript}");
    for case in EXPECTED {
        assert!(transcript.contains(&format!("{case} (")),
            "RP-13 missing required fixture {case}:\n{transcript}");
    }
}
