// Pre: fill local_path_* from monorepo rust/ when unset/empty (else crates.io).
fn local_crate_path(app_dir, crate_name) {
    if app_dir == () || app_dir == "" {
        return "";
    }
    let cmd = "app_dir='" + app_dir + "'; crate='" + crate_name + "'; d=\"$app_dir\"; "
        + "while [ -n \"$d\" ] && [ \"$d\" != / ]; do "
        + "if [ -f \"$d/rust/Cargo.toml\" ] && [ -d \"$d/rust/psibase\" ]; then "
        + "realpath -m --relative-to=\"$app_dir\" \"$d/rust/$crate\"; exit 0; "
        + "fi; d=$(dirname \"$d\"); done";
    let out = system::command("bash", ["-c", cmd]);
    if out == () {
        return "";
    }
    return out;
}

fn needs_fill(name) {
    if !variable::is_set(name) {
        return true;
    }
    return variable::get(name) == "";
}

let app_dir = system::command("bash", ["-c", "printenv PSIBASE_INSTANTIATE_APP_DIR || true"]);
if app_dir == () || app_dir == "" {
    app_dir = env::destination_directory;
}

if needs_fill("local_path_psibase") {
    variable::set("local_path_psibase", local_crate_path(app_dir, "psibase"));
}
if needs_fill("local_path_psibase_macros") {
    variable::set("local_path_psibase_macros", local_crate_path(app_dir, "psibase_macros"));
}
if needs_fill("local_path_psibase_service") {
    variable::set("local_path_psibase_service", local_crate_path(app_dir, "psibase_service"));
}
