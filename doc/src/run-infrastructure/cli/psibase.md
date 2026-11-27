# psibase

## NAME

psibase - The psibase blockchain command line client

## SYNOPSIS

`psibase` `boot` [`-a` *url*] [`-p` *name*] [`-k` *public-key*] [*packages*\.\.\.]  
`psibase` `create` [`-a` *url*] [`-i` | `-k` *public-key* | `-o` *account*] [`-S` *sender*] *name*  
`psibase` `deploy` [`-a` *url*] [`-p`] *account* *wasm* *schema*  
`psibase` `info` [`-a` *url*] *packages*\.\.\.  
`psibase` `install` [`-a` *url*] [`-S` *sender*] *packages*\.\.\.  
`psibase` `key` `generate` [`--pem`] [`-o` *file*]  
`psibase` `key` `show` [`--private` [`--pem`]] *key*  
`psibase` `list` [`-a` *url*] [`--all` | `--available` | `--installed` | `--updates`]  
`psibase` `login` [`-a` *url*] *account*  
`psibase` `modify` [`-a` *url*] [`-i` | `-k` *public-key* | `-o` *account*] *account*  
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
  - A secp256k1 private key in WIF, the one-line base58 form that Bitcoin tools read and write (`K...` or `L...`; see [key](#key)), or a file containing one. Prefer the file: a key typed on the command line stays in the shell's history.
  - A file containing a PEM or DER encoded private key (PKCS #8). This is the form for P-256 keys.
  - A PKCS #11 URI

  ```
  psibase push -s alice.key actions.json
  ```

  The claim for the key names the default verify service for its type. For an account that chose another verify service (see `modify`), write *verifier*`=`*private-key*, for example `-s verify-br1=alice.pem`.

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

> **A chain booted without `--block-key` is open to everyone.** The `root` account is controlled by the producers, and producers authorize with their block signing keys. With no block key there is nothing to check, so anyone who can reach the node can send an unsigned transaction as `root`: create accounts, change services, anything. This is convenient on a developer's machine and must never be reachable from a network. `-k` alone sets the producer's account key and does not close it.
>
> For any node that others can reach, boot with both `--block-key` and `-k`. The node can generate the block key itself (`POST` to `x-admin`'s `/native/admin/keys`, see [x-admin](../../default-apps/x-admin.md)). Afterwards, check it: an unsigned transaction from `root` must be refused.

- *packages*

  Packages to install to the chain. If not specifed, a default set will be installed.

- `-k`, `--account-key` *public-key*

  Set the producer account to use this key for transaction authentication. The public key can be any of the following:
  - A secp256k1 private key in WIF, or a file containing one (for example the file that `psibase key generate -o` wrote). It stands for its public key; the private key is not sent anywhere.
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `--block-key` *public-key*

  Set the producer's block signing key. The public key can be any of the following:
  - A secp256k1 private key in WIF, or a file containing one (for example the file that `psibase key generate -o` wrote). It stands for its public key; the private key is not sent anywhere.
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

Create an account. If the account already exists, verify that its authentication is the same as what would be created.

- `-i`, `--insecure`

  The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public chains.

- `-k`, `--key` *public-key*

  Set the account to authenticate using this key. The public key can be any of the following:
  - A secp256k1 private key in WIF, or a file containing one (for example the file that `psibase key generate -o` wrote). It stands for its public key; the private key is not sent anywhere.
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

- `-o`, `--owner` *account*

  Set the account to be owned by another account [default: *sender*]

- `-S`, `--sender` *account*

  Sender to use when creating the account [default: root].

### deploy

`psibase` `deploy` [`-a` *url*] [`-p`] *account* *wasm* *schema*  

Deploy a service

- *account*

  Account to deploy the service on

- *wasm*

  Path to a wasm file containing the service

- *schema*

  Path to a JSON file containing the schema for the service

- `-c`, `--create`

  Create the account if it doesn't exist. If the account does exist, verify that its authentication is that same as what would be created.

- `-i`, `--insecure`

  Requires `--create`. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public.

- `-k`, `--key`

  Requires `--create`. Set a new account to authenticate using this key.

- `-o`, `--owner` *owner*

  Requires `--create`. Set the account to be owned by another account [default: *sender*]

- `-p`, `--register-proxy`

  Register the service with HttpServer. This allows the service to host a website, serve RPC requests, and serve GraphQL requests.

- `-S`, `--sender` *sender*

  Requires `--create`. Sender to use when creating the account [default: root]

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

`psibase` `install` [`-a` *url*] [`-S` *sender*] *packages*\.\.\.  

Install packages to the chain along with all dependencies. If any of the requested packages are already installed, they will be updated if a newer version is available.

- *packages*

  Packages to install

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

### key

`psibase` `key` `generate` [`--pem`] [`-o` *file*]  
`psibase` `key` `show` [`--private` [`--pem`]] *key*  

Create a private key, or show a key in another form. Neither command talks to a node.

A secp256k1 private key is written in WIF (wallet import format), the same string that Bitcoin tools read and write:

```
KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617
```

The alternative is a PKCS #8 PEM document, the form OpenSSL reads, and the only form for P-256 keys:

```
-----BEGIN PRIVATE KEY-----
MGQCAQAwEAYHKoZIzj0CAQYFK4EEAAoETTBLAgEBBCAMKPyjhseiJ2ALL+ULfK4R
7IbTvx++RxvomCfhnXKqHaEkAyIAAtDeCq6u+tAri9yKAaG4sRxpa9PWaixfEHgN
lbffQmRc
-----END PRIVATE KEY-----
```

Every option that takes a key takes either form.

`key generate` creates a new secp256k1 key and prints it in WIF.

- `-o`, `--output` *file*

  Write the key to *file* instead of printing it. The file must not exist and is created readable by its owner only.

- `--pem`

  Write the key as a PKCS #8 PEM document instead of WIF

`key show` prints the public key of *key* as a PEM document. *key* is a private key in any form that `--sign` takes.

- `--private`

  Print the private key instead, in WIF. Only secp256k1 keys have that form.

- `--pem`

  With `--private`, print the private key as a PKCS #8 PEM document instead of WIF

```
psibase key generate -o alice.key           # a new key, in WIF
psibase create alice -k alice.key           # an account that uses its public key
psibase push -s alice.key actions.json      # sign with it
psibase key show alice.key                  # its public key, PEM
psibase key show --private --pem alice.key  # the private key, PEM
```

A WIF string also says in which form the public key is used. Strings that start with `K` or `L` (what `key generate` writes) stand for the compressed form of the public key, and the older strings that start with `5` for the uncompressed form. The chain compares the key in a signature's claim with the account's key byte for byte, so an account must be signed for with the form it was created with. A PEM file made by `openssl genpkey` holds the uncompressed form: an account created from such a file's public key is signed for with that file, or with the `5...` string that `psibase key show --private` prints for it. Strings that start with `c` or `9` are the same two forms as written by wallets on Bitcoin's test networks; they are accepted and name the same keys.

### login

`psibase` `login` [`-a` *url*] *account*  

Get a bearer token that can used to access authenticated APIs. The token can only be used with the host that created it. The request must be signed with the same keys that the account would use for a transaction.

- *account*

  The account logging in

### modify

`psibase` `modify` [`-a` *url*] [`-i` | `-k` *public-key*] *account*  

Modify an account

- `-c`, `--create`

  Create the account if it doesn't already exist

- `-i`, `--insecure`

  Make the account insecure, even if it has been previously secured. Anyone will be able to authorize as this account without signing. Caution: this option should not be used on production or public chains
  
- `-k`, `--key` *public-key*

  Set the account to authenticate using this key. The public key can be any of the following:
  - A secp256k1 private key in WIF, or a file containing one (for example the file that `psibase key generate -o` wrote). It stands for its public key; the private key is not sent anywhere.
  - A file containing a PEM or DER encoded public key
  - A PKCS #11 URI

  The key becomes both the owner key and the active key of the account in `auth-sig`. This is for an account that does not use `auth-sig` yet; one that does changes its keys with the `auth-sig` actions `setActive` and `requestOwnerChange` (see [auth-sig](../../default-apps/auth-sig.md)), which `psibase push` can send. Signatures are verified by the default verify service for the key's type (`verify-k1` for secp256k1, `verify-r1` for P-256). To choose another verify service allowed for the key, write *verifier*`=`*public-key*, for example `-k verify-br1=alice.pub`. Transactions for the account are then signed with `-s verify-br1=alice.pem`.

- `-o`, `--owner` *owner*

  Set the account to be owned by *owner* [default: *sender*]

- `-S`, `--sender` *sender*

  Requires `--create`. Sender to use when creating the account [default: root]

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
