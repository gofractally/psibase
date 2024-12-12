let project_name = variable::get("project-name");

let has_number = false;
for digit in "0123456789".to_chars() {
    if project_name.contains(digit) {
        has_number = true;
        break;
    }
}

if has_number {
    abort(`Invalid project name: "${project_name}". Use lowercase letters, no numbers, kebab-case. (e.g. my-project)`);
}

if project_name.len() > 12 {
    abort(`Invalid project name: "${project_name}". Project name must be 12 characters or less.`);
}
