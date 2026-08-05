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

// Account names are max 10 chars on the 0.23 train. The query service account is
// `r-<project-name>`, so the project name itself must be ≤ 8 characters.
if project_name.len() > 8 {
    abort(`Invalid project name: "${project_name}". For the SDK (psibase 0.23), use ≤ 8 lowercase kebab-case chars (query account is r-<name>).`);
}
