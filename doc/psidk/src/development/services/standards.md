# Standards

## Reserved account names

By convention, apps that are specific to an individual node operator are hosted at subdomains that begin with "x-". Therefore, to avoid being overshadowed by these apps, user account names may not begin with "x-".

## Standard actions

psibase standard action names end with `Sys` or `_Sys` (case insensitive). Do not define your own actions with this prefix or your service may misbehave when future standards are adopted. For example, don't create an action named `emphasys`.

The following standard actions exist for both Rust and C++, though only the C++ code examples are listed below.

- *serveSys* - `optional<HttpReply> serveSys(HttpRequest request)`
- *storeSys* - `void storeSys(std::string path, std::string contentType, std::vector<char> content)`

> ➕ TODO - Document other standard actions