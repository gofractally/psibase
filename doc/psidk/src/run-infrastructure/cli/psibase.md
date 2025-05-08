# psibase

## NAME

psibase - The psibase blockchain command line client

## SYNOPSIS

`psibase` [`-a` *url*] `boot` [`-p` *name*] [`-k` *public-key*] [*packages*\.\.\.]  
`psibase` [`-a` *url*] `create` [`-i` | `-k` *public-key*] [-S *sender*] *name*  
`psibase` [`-a` *url*] `deploy` [`-p`] *account* *wasm* *schema*  
`psibase` [`-a` *url*] `info` *packages*\.\.\.  
`psibase` [`-a` *url*] `install` [`-k` *public-key*] *packages*\.\.\.  
`psibase` [`-a` *url*] `list` [`--all` | `--available` | `--installed` | `--updates`]  
`psibase` [`-a` *url*] `modify` [`-i` | `-k` *public-key*] *account*  
`psibase` [`-a` *url*] `publish` `-S` *sender* *files*\.\.\.  
`psibase` [`-a` *url*] `search` *regex*\.\.\.  
`psibase` [`-a` *url*] `upgrade` [`--latest`] [*packages*\.\.\.]  
`psibase` [`-a` *url*] `upload` [`-r`] [`-t` *content-type*] *source* [*dest*] `-S` *sender*  
`psibase` `create-token` [`-e` *expiration*] [`-m` *mode*]  
`psibase` *subcommand* [*args*\.\.\.]  

## DESCRIPTION

`psibase` is the command-line tool for interacting with psibase blockchains.

## OPTIONS

- `-a`, `--api` *url*

  `psinode` API Endpoint. The default is `http://psibase.localhost/`
  
- `-h`, `--help`

  Print help information

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

`psibase` [`-a` *url*] `boot` [`-p` *name*] [`-k` *public-key*] [*packages*\.\.\.]  

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

### create

`psibase` [`-a` *url*] `create` [`-i` | `-k` *public-key*] [-S *sender*] *name*  

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

`psibase` [`-a` *url*] `deploy` [`-p`] *account* *wasm* *schema*  

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

`psibase` [`-a` *url*] `info` *packages*\.\.\.  

Displays the contents of packages

- *packages*

  Packages to show

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

### install

`psibase` [`-a` *url*] `install` [`-k` *public-key*] *packages*\.\.\.  

Install packages to the chain along with all dependencies. If any of the requested packages are already installed, they will be updated if a newer version is available.

- *packages*

  Packages to install

- `-k` *public-key*

  Set all accounts created by the new packages to authenticate using this key. If no key is provided, the accounts will not require authentication. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `--reinstall`

  Packages that are requested directly (not dependencies) will be installed even if they are already installed and up-to-date.

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

### list

`psibase` [`-a` *url*] `list` [`--all` | `--available` | `--installed` | `--updates`]  

Prints a list of packages from the chain and/or package repositories

- `--all`

  Prints all known packages (default)
  
- `--available`

  Prints packages that are available in the repository, but not installed on chain
  
- `--installed`

  Prints packages that are currently installed

- `--updates`

  Prints installed packages that have newer versions available in the repository

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

### modify

`psibase` [`-a` *url*] `modify` [`-i` | `-k` *public-key*] *account*  

Modify an account

- `-i`, `--insecure`

  Make the account insecure, even if it has been previously secured. Anyone will be able to authorize as this account without signing. Caution: this option should not be used on production or public chains
  
- `-k`, `--key`

  Set the account to authenticate using this key. The public key can be any of the following:
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

### publish

`psibase` [`-a` *url*] `publish` `-S` *sender* *files*\.\.\.  

Publish packages to a package repository. A package will be skipped if the sender has already published it with the same version.

- `-S` *sender*

  The account that owns the packages

- *files*

  Package files to publish

### search

`psibase` [`-a` *url*] `search` *regex*\.\.\.  

Search for packages

- *regex*

  Regular expressions to match agaist the package names and descriptions. If there are multiple patterns, they must all match for a package to be listed. The search is case-insensitive.

- `--package-source` *url*

  Specifies a package repository. If multiple repositories are provided, the ones listed earlier will be preferred over those listed later. The default is the local package repository.

### upgrade

`psibase` [`-a` *url*] `upgrade` [`--latest`] [*packages*\.\.\.]  

Upgrade installed packages. This will not upgrade packages to a new major version unless `--latest` is used.

- `--latest`

  Don't limit upgrades to versions that are compatible with the current version.

- *packages*

  The names of packages to upgrade. The default is to upgrade all packages that are currently installed.

### upload

`psibase` [`-a` *url*] `upload` [`-r`] [`-t` *content-type*] *source* [*dest*] `-S` *sender*  

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

### create-token

`psibase` `create-token` [`-e` *expiration*] [`-m` *mode*]  

Create an access token. `psibase` will prompt for the key to use to sign the token. For the token to be useful, the server must enable bearer tokens with the same key.

- `-e`, `--expires-after` *seconds*

  Lifetime of the token in seconds. The default is 1 hour.
  
- `-m`, `--mode` *mode*

  The permissions granted by the token. Should be `r` or `rw`. The default is `rw`.

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
