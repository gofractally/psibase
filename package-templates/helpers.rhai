fn before_comment(line) {
    let s = line.split("#", 2)[0];
    s.trim();
    s
}

fn quote_single_for_bash(path) {
    let t = path + "";
    t.replace("'", "'\"'\"'");
    "'" + t + "'"
}

fn join_lines(lines) {
    let out = "";
    let i = 0;
    while i < lines.len() {
        if i > 0 { out += "\n"; }
        out += lines[i];
        i += 1;
    }
    out
}

fn heredoc_write(path, content) {
    let marker = "CGEOF";
    let cmd = "cat <<'" + marker + "' > " + quote_single_for_bash(path) + "\n";
    cmd += content;
    if !content.ends_with("\n") { cmd += "\n"; }
    cmd += marker + "\n";
    system::command("bash", ["-lc", cmd]);
}

fn get_additions(subdirs) {
    let project_name = variable::get("project-name");
    let crate_dir_name = to_upper_camel_case(project_name);
    let additions = [ crate_dir_name ];
    let i = 0;
    while i < subdirs.len() {
        additions.push(crate_dir_name + "/" + subdirs[i]);
        i += 1;
    }
    additions
}

fn scan_workspace_members(lines) {
    let inside = false;
    let closing = -1;
    let members = [];

    for (line, idx) in lines {
        let before = before_comment(line);

        if !inside {
            if !before.is_empty() && before.starts_with("members") && before.contains("[") {
                inside = true;
            }
            continue;
        }

        if before.is_empty() { continue; }

        if before == "]" {
            closing = idx;
            break;
        }

        let parts = before.split("\"");
        if parts.len() > 1 {
            members.push(parts[1]);
        }
    }

    if closing < 0 {
        abort(`Unable to locate workspace members array`);
    }

    #{ members: members, insertion_idx: closing }
}

fn get_manifest_path() {
    let destination = env::destination_directory;
    if destination.is_empty() {
        abort("Destination path not provided by cargo-generate");
    }
    destination + "/Cargo.toml"
}

fn read_lines(path) {    
    let file_contents = system::command("cat", [path]) + "";
    file_contents.split("\n")
}

fn add_workspace_members(subdirs) {
    let manifest_path = get_manifest_path();
    let lines = read_lines(manifest_path);
    let scan = scan_workspace_members(lines);
    let members = scan["members"];
    let insertion_idx = scan["insertion_idx"];

    let additions = get_additions(subdirs);

    let inserted = 0;
    let pos = 0;
    while pos < additions.len() {
        let value = additions[pos];
        if !members.contains(value) {
            lines.insert(insertion_idx, `    "${value}",`);
            insertion_idx += 1;
            members.push(value);
            inserted += 1;
        }
        pos += 1;
    }

    if inserted > 0 {
        let new_manifest = join_lines(lines);
        heredoc_write(manifest_path, new_manifest);
    } else {
        print("cargo-generate add-to-workspace hook: no new members added");
    }
}