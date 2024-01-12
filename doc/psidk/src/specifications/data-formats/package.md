# Package

A psibase package is a zip archive that contains the following files:

## meta.json

| Field       | Type   | Description                                    |
|-------------|--------|------------------------------------------------|
| name        | String | The name of the package                        |
| description | String | The package description                        |
| depends     | Array  | Names of packages that this package depends on |
| accounts    | Array  | Accounts that are created by this package      |

## service/&lt;service&gt;.wasm

A wasm file that will be deployed to the service account.

## service/&lt;service&gt;.json

Properties associated with a service.

| Field  | Type    | Description                                                                                                                                                                   |
|--------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| flags  | Array   | Can contain the following strings: `"allowSudo"`, `"allowWriteNative"`, `"isSubjective"`, `"allowWriteSubjective"`, `"canNotTimeOut"`, `"canSetTimeLimit"`, `"isAuthService"` |
| server | String  | The account that will handle HTTP requests for the service                                                                                                                    |

## data/&lt;service&gt;/*

Files that will be uploaded using the `storeSys` action.

## script/postinstall.json

Contains an array of actions that will be executed after the service is deployed.
