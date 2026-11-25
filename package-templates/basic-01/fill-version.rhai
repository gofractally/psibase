// Init: default `version` from monorepo rust/Cargo.toml when unset.
fn monorepo_version(start) {
    if start == () || start == "" {
        return "";
    }
    let cmd = "d='" + start + "'; "
        + "while [ -n \"$d\" ] && [ \"$d\" != / ]; do "
        + "if [ -f \"$d/rust/Cargo.toml\" ] && [ -d \"$d/rust/psibase\" ]; then "
        + "sed -n '/^\\[workspace.package\\]/,/^\\[/{s/^version = \"\\([^\"]*\\)\"/\\1/p}' \"$d/rust/Cargo.toml\" | head -1; "
        + "exit 0; fi; d=$(dirname \"$d\"); done";
    let out = system::command("bash", ["-c", cmd]);
    if out == () {
        return "";
    }
    return out;
}

if !variable::is_set("version") {
    let start = system::command("bash", ["-c", "printenv PSIBASE_INSTANTIATE_APP_DIR || printenv PWD || true"]);
    if start == () {
        start = "";
    }
    if start == "" {
        start = env::destination_directory;
    }
    let ver = monorepo_version(start);
    if ver != "" {
        variable::set("version", ver);
    }
}
