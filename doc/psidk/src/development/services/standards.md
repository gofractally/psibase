# Standards

## Standard account names

Subjective system services have account names which begin with `x-`. Only the infrastructure providers may create accounts with this suffix.

## Standard actions

psibase standard action names end with `Sys` or `_Sys` (case insensitive). Do not define your own actions with this prefix or your service may misbehave when future standards are adopted. For example, don't create an action named `emphasys`.

The following standard actions exist for both Rust and C++, though only the C++ code examples are listed below.

- *serveSys* - `optional<HttpReply> serveSys(HttpRequest request)`
- *storeSys* - `void storeSys(std::string path, std::string contentType, std::vector<char> content)`

> ➕ TODO - Document other standard actions