# Sites conditional response policy regression

Sites' 304 branch now includes the current `Content-Security-Policy` and
`Cache-Control: no-cache`, matching its normal 200 response. Policy changes do
not change file bytes or their content-derived ETag; a conditional response must
therefore refresh the policy metadata as well.

The native regression first creates a dedicated account/file and CSP before the
upgrade. It reproduces the old 304 response lacking policy/cache headers. After
deploying only Sites' code and generated schema, it verifies existing file bytes,
ETag and configuration remain intact. It then changes only CSP, confirms an
If-None-Match GET and HEAD return 304 with the new policy/no-cache, confirms a
fresh 200 returns identical bytes/ETag with the new policy, and checks disabling
the account's cache still returns 200. The test restores caching afterward.

Current and released Sites headers have identical row fields, reflection field
orders, table keys and ServiceTables ordering; differences are only a static
default-page constant and documentation. The generated schema's expanded four
database table layouts are also compared against the released package and must
match before deployment. Existing flags (`[]`), data, references, site settings,
proxies and policies are preserved. No initialization/reinstallation is run.

`build.py` uses the same isolated current HTTP source / release-library
compatibility pattern as the CommonApi and HttpServer builds. Provenance and
checks are in `provenance.json`, `before-upgrade.json`, `verification.json` and
`deploy-trace.json`.
