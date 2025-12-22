# psibase

## NAME

psibase - The psibase blockchain command line client

## SYNOPSIS

`psibase` `boot` [`-a` *url*] [`-p` *name*] [`-k` *public-key*] [*packages*\.\.\.]  
`psibase` `create` [`-a` *url*] [`-i` | `-k` *public-key*] [`-S` *sender*] *name*  
`psibase` `deploy` [`-a` *url*] [`-p`] *account* *wasm* *schema*  
`psibase` `info` [`-a` *url*] *packages*\.\.\.  
`psibase` `install` [`-a` *url*] [`-k` *public-key*] *packages*\.\.\.  
`psibase` `list` [`-a` *url*] [`--all` | `--available` | `--installed` | `--updates`]  
`psibase` `login` [`-a` *url*] *account*  
`psibase` `modify` [`-a` *url*] [`-i` | `-k` *public-key*] *account*  
`psibase` `publish` [`-a` *url*] `-S` *sender* *files*\.\.\.  
`psibase` `push` [`-a` *url*] *files*\.\.\.  
`psibase` `search` [`-a` *url*] *regex*\.\.\.  
`psibase` `upgrade` [`-a` *url*] [`--latest`] [*packages*\.\.\.]  
`psibase` `upload` [`-a` *url*] [`-r`] [`-t` *content-type*] *source* [*dest*] `-S` *sender*  
`psibase` *subcommand* [*args*\.\.\.]  

## DESCRIPTION

`psibase` is the command-line tool for interacting with psibase blockchains.

## OPTIONS

- `-a`, `--api` *url*

  `psinode` API Endpoint. The default is `http://psibase.localhost:8080/`

- `--console[=true|false]`

  For commands that push transactions to the chain, controls whether the console output of the transactions is shown

- `-h`, `--help`

  Print help information

- `--proposer` *account*

  For commands that push transactions to the chain, the transactions will be proposed as staged transactions instead of being directly applied.

- `--proxy` *url*

  Proxy for HTTP request. The URL's scheme can be `http:`, `https:`, or `unix:`.

- `-s`, `--sign` *private-key*

  Sign transactions with this key. The key can be in any of the following forms:
  - A file containing a PEM or DER encoded private key
  - A PKCS #11 URI

- `--trace` *format*

  For commands that push transactions to the chain, determines how the result is reported.
  - `error`: If the transaction failed, show the error message
  - `stack` (default): If the transaction failed, show a stack trace from the action that caused the error
  - `full`: Shows all actions in the trace
  - `json`: Shows the full transaction trace as JSON

## COMMANDS

### boot

`psibase` `boot` [`-a` *url*] [`-p` *name*] [`-k` *public-key*] [*packages*\.\.\.]  

The boot command deploys a set of system services and web interfaces suitable for development. The chain will have a single block producer. The chain can only be booted once.

- *packages*

  Packages to install to the chain. If not specifed, a default set will be installed.

- `-k`, `--account-key` *public-key*

  Set the producer account to use this key for transaction authentication. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `--block-key` *public-key*

  Set the producer's block signing key. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `-p`, `--producer` *name*

  Set the name of the block producer. `psinode` should be configured to use the same name.

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-z`, `--compression-level` *level*

  Configure compression level for static content uploaded by the boot packages (1=fastest, 11=most compression) [default: 4]

### create

`psibase` `create` [`-a` *url*] [`-i` | `-k` *public-key*] [`-S` *sender*] *name*  

Create or modify an account

- `-i`, `--insecure`

  The account won't be secured; anyone can authorize as this account without signing. This option does nothing if the account already exists. Caution: this option should not be used on production or public chains.

- `-k`, `--key` *public-key*

  Set the account to authenticate using this key. Also works if the account already exists. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `-S`, `--sender` *account*

  Sender to use when creating the account [default: accounts].

### deploy

`psibase` `deploy` [`-a` *url*] [`-p`] *account* *wasm* *schema*  

Deploy a service

- *account*

  Account to deploy the service on

- *wasm*

  Path to a wasm file containing the service

- *schema*

  Path to a JSON file containing the schema for the service

- `-c`, `--create-account` *public-key*

  Create the account if it doesn't exist. Also set the account to authenticate using this key, even if the account already existed

- `-i`, `--create-insecure-account`

  Create the account if it doesn't exist. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public.

- `-p`, `--register-proxy`

  Register the service with HttpServer. This allows the service to host a website, serve RPC requests, and serve GraphQL requests.

- `-S`, `--sender` *sender*

  Sender to use when creating the account [default: accounts]

### info

`psibase` `info` [`-a` *url*] *packages*\.\.\.  

Displays the contents of packages

- *packages*

  Packages to show

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-S`, `--sender` *account*

  Account that would install the packages. If this account has configured package sources on-chain, those sources will be used [default: root]

### install

`psibase` `install` [`-a` *url*] [`-k` *public-key*] *packages*\.\.\.  

Install packages to the chain along with all dependencies. If any of the requested packages are already installed, they will be updated if a newer version is available.

- *packages*

  Packages to install

- `-k`, `--key` *public-key*

  Set all accounts created by the new packages to authenticate using this key. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `--local`

  Instead of installing to the chain, install local packages to a single node

- `--reinstall`

  Packages that are requested directly (not dependencies) will be installed even if they are already installed and up-to-date.

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-S`, `--sender` *sender*

  Sender to use for installing. The packages and all accounts that they create will be owned by this account. If this account has configured package sources on-chain, those sources will be used [default: root]

- `-z`, `--compression-level` *level*

  Configure compression level for static content uploaded by the packages (1=fastest, 11=most compression) [default: 4]

### list

`psibase` `list` [`-a` *url*] [`--all` | `--available` | `--installed` | `--updates`]  

Prints a list of packages from the chain and/or package repositories

- `--all`

  Prints all known packages (default)
  
- `--available`

  Prints packages that are available in the repository, but not installed on chain
  
- `--installed`

  Prints packages that are currently installed

- `--updates`

  Prints installed packages that have newer versions available in the repository

- `--local`

  Search for node-local packages instead of on-chain packages

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-S`, `--sender` *account*

  Account that would install the packages. If this account has configured package sources on-chain, those sources will be used [default: root]

### login

`psibase` `login` [`-a` *url*] *account*  

Get a bearer token that can used to access authenticated APIs. The token can only be used with the host that created it. The request must be signed with the same keys that the account would use for a transaction.

- *account*

  The account logging in

### modify

`psibase` `modify` [`-a` *url*] [`-i` | `-k` *public-key*] *account*  

Modify an account

- `-i`, `--insecure`

  Make the account insecure, even if it has been previously secured. Anyone will be able to authorize as this account without signing. Caution: this option should not be used on production or public chains
  
- `-k`, `--key`

  Set the account to authenticate using this key. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

### publish

`psibase` `publish` [`-a` *url*] `-S` *sender* *files*\.\.\.  

Publish packages to a package repository. A package will be skipped if the sender has already published it with the same version.

- `-S` *sender*

  The account publishing the packages. Files are uploaded to this account's subdomain

- *files*

  Package files to publish

### push

`psibase` `push` [`-a` *url*] *files*\.\.\.  

Push a transaction to the chain.

- *files*

  Each file should be JSON containing a list of actions to run. All the actions from all files will be merged into one transaction. If no files are provided, reads the actions from stdin.

### search

`psibase` `search` [`-a` *url*] *regex*\.\.\.  

Search for packages

- *regex*

  Regular expressions to match agaist the package names and descriptions. If there are multiple patterns, they must all match for a package to be listed. The search is case-insensitive.

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-S`, `--sender` *account*

  Account that would install the packages. If this account has configured package sources on-chain, those sources will be used [default: root]

### upgrade

`psibase` `upgrade` [`-a` *url*] [`--latest`] [*packages*\.\.\.]  

Upgrade installed packages. This will not upgrade packages to a new major version unless `--latest` is used.

- *packages*

  The names of packages to upgrade. The default is to upgrade all packages that are currently installed.

- `-k`, `--key` *public-key*

  Set all accounts created by new packages to authenticate using this key. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `--latest`

  Don't limit upgrades to versions that are compatible with the current version.

- `--local`

  Instead of installing to the chain, install local packages to a single node

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

- `-S`, `--sender` *sender*

  Sender to use for installing. The packages and all accounts that they create will be owned by this account. If this account has configured package sources on-chain, those sources will be used [default: root]

- `-z`, `--compression-level` *level*

  Configure compression level for static content uploaded by the packages (1=fastest, 11=most compression) [default: 4]

### upload

`psibase` `upload` [`-a` *url*] [`-r`] [`-t` *content-type*] *source* [*dest*] `-S` *sender*  

Upload a file to a service's subdomain. The file will be stored to and served from the sender's namespace within the `sites` service.

- `-r`, `--recursive`

  If *source* is a directory, upload its contents recursively. The files may be split across multiple transactions if they are too large to fit in a single transaction.

- `-t`, `--content-type` *content-type*

  MIME Content-Type of the file. If not specified, it will be guessed from the file name. Cannot be used with `-r`.

- *source*

  Source filename to upload

- *dest*

  Destination path at the subdomain from which the file will be served. If not specified, defaults to the file name of *source* or `/` for recursive uploads.

- `-S`, `--sender` *sender*

  Account to use as the sender of the transaction. Required. Files are uploaded to this account's subdomain.

- `-z`, `--compression-level` *level*

  Configure compression level for the files (1=fastest, 11=most compression) [default: 4]

### Custom Commands

`psibase` *subcommand* [*args*\.\.\.]__

Additional `psibase` subcommands can be implemented in WASM. They will be found in *$PREFIX/share/psibase/wasm/*.

## FILES

- *$PREFIX/share/psibase/packages/index.json*

  Local package repository

- *$PREFIX/share/psibase/wasm/psibase-\*.wasm*

  Custom subcommands

## SEE ALSO

[`psibase-create-snapshot`(1)](psibase-create-snapshot.md), [`psibase-load-snapshot`(1)](psibase-load-snapshot.md)
