# Package

A psibase package is a zip archive that contains the following files:

## meta.json

| Field              | Type   | Description                                                                                            |
|--------------------|--------|--------------------------------------------------------------------------------------------------------|
| name               | String | The name of the package                                                                                |
| version            | String | The package version. Must conform to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). |
| description        | String | The package description                                                                                |
| depends            | Array  | Other packages that this package depends on                                                            |
| depends[n].name    | String | The name of the other package                                                                          |
| depends[n].version | String | An expression that describes the compatible versions of the dependency                                 |
| accounts           | Array  | Accounts that are created by this package                                                              |

### Semantic version matching

The `version` field in the dependency list is a string that holds a comma separated list of patterns: `[op] version, [op] version, ...`. The version can be a be a full semantic version, the major and minor versions, or just the major version. If the components of a prefix match the corresponding components of a non-prerelease version, it is considered an exact match.

- `^` matches any compatible version that is not older than the version given. This is the default.
- `~` only allows patch updates.
- Comparison operators `=`, `!=` , `<`, `<=`, `>`, `<=` are evaluated according to [semantic version precedence](https://semver.org/spec/v2.0.0.html#spec-item-11).
- Logical operators `&&` and `||` can be used to combine multiple expressions. `&&` has higher precedence than `||`
- Expressions can be grouped with `()`

Examples:
- `1`: matches `1.0.0` and `1.3.1`, but not `2.0.0` or `1.2.0-rc1`
- `>=1.1.2, <2.0.0` matches `1.1.3` and `2.0.0-beta`
- `>1, <3` matches all versions with major version 2, including prereleases

## service/&lt;service&gt;.wasm

A wasm file that will be deployed to the service account.

## service/&lt;service&gt;.json

Properties associated with a service.

| Field  | Type    | Description                                                                                                                                                                   |
|--------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| flags  | Array   | Can contain the following strings: `"isPrivileged"`, `"isVerify"`, `"runModeRpc"`, `"runModeCallback"` |
| server | String  | The account that will handle HTTP requests for the service                                                                                                                    |

### Flags

- `isPrivileged`: The service has access to restricted databases and host functions
- `isVerify`: The service can be used to verify signatures
- `runModeRpc`: When the service is run in a transaction, switch to RPC mode and save the result on the block producer. On replay, skip execution and return the same result as the block producer.
- `runModeCallback`: When the service is run in a transaction, switch to callback mode and save the result on the block producer. On replay, suppress errors, ignore the return value, and return the same result as the block producer.

## data/&lt;service&gt;/*

Files that will be uploaded to the service's namespace within the the `sites` app, accessible from the service's subdomain.

## script/postinstall.json

Contains an array of actions that will be executed after the service is deployed.
