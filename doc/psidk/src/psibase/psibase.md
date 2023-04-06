# psibase

## NAME

psibase - The psibase blockchain command line client

## SYNOPSIS

`psibase` [`-a` *url*] `boot` [`-p` *name*] [`-k` *public-key*] [`--no-doc`]  
`psibase` [`-a` *url*] `create` [`-i` | `-k` *public-key*] [-S *sender*] *name*  
`psibase` [`-a` *url*] `deploy` [`-p`] *account* *filename*  
`psibase` [`-a` *url*] `modify` [`-i` | `-k` *public-key*] *account*  
`psibase` [`-a` *url*] `upload` *service* *dest* *content-type* *source*  
`psibase` [`-a` *url*] `upload-tree` *service* *dest* *source*  

## DESCRIPTION

`psibase` is the command-line tool for interacting with psibase blockchains.

## OPTIONS

- `-a`, `--api` *url*

  `psinode` API Endpoint. The default is `http://psibase.127.0.0.1.sslip.io/`
  
- `-h`, `--help`

  Print help information

- `-s`, `--sign` *private-key*

  Sign transactions with this key

## COMMANDS

### boot

`psibase` [`-a` *url*] `boot` [`-p` *name*] [`-k` *public-key*]  

The boot command deploys a set of system services and web interfaces suitable for development. The chain will have a single block producer. The chain can only be booted once.

- `-k`, `--key` *public-key*

  Set all accounts to authenticate using this key. The key will also be used for block production. If no key is provided, the accounts will not require authentication.

- `-p`, `--producer` *name*

  Set the name of the block producer. `psinode` should be configured to use the same name.

- `--no-doc`

  Do not upload psibase documentation

### create

`psibase` [`-a` *url*] `create` [`-i` | `-k` *public-key*] [-S *sender*] *name*  

Create or modify an account

- `-i`, `--insecure`

  The account won't be secured; anyone can authorize as this account without signing. This option does nothing if the account already exists. Caution: this option should not be used on production or public chains.

- `-k`, `--key` *public-key*

  Set the account to authenticate using this key. Also works if the account already exists.

- `-S`, `--sender` *account*

  Sender to use when creating the account [default: account-sys].

### deploy

`psibase` [`-a` *url*] `deploy` [`-p`] *account* *filename*  

Deploy a service

- *account*

  Account to deploy the service on

- *filename*

  A wasm file containing the service

- `-c`, `--create-account` *public-key*

  Create the account if it doesn't exist. Also set the account to authenticate using this key, even if the account already existed

- `-i`, `--create-insecure-account`

  Create the account if it doesn't exist. The account won't be secured; anyone can authorize as this account without signing. Caution: this option should not be used on production or public.

- `-p`, `--register-proxy`

  Register the service with ProxySys. This allows the service to host a website, serve RPC requests, and serve GraphQL requests.
  
- `-S`, `--sender` *sender*

  Sender to use when creating the account [default: account-sys]

### modify

`psibase` [`-a` *url*] `modify` [`-i` | `-k` *public-key*] *account*  

Modify an account

- `-i`, `--insecure`

  Make the account insecure, even if it has been previously secured. Anyone will be able to authorize as this account without signing. Caution: this option should not be used on production or public chains
  
- `-k`, `--key`

  Set the account to authenticate using this key

### upload

`psibase` [`-a` *url*] `upload` *service* *dest* *content-type* *source*  

Upload a file to a service. The service must provide a `storeSys` action.

- *service*

  Service to upload to
  
- *dest*

  Destination path within *service*
  
- *content-type*

  MIME Content-Type of the file
  
- *source*

  Source filename to upload

- `-S`, `--sender` *sender*

  Account to use as the sender of the transaction. Defaults to the *service* account.

### upload-tree

`psibase` [`-a` *url*] `upload-tree` *service* *dest* *source*  

Upload a directory tree to a service. The service must provide a `storeSys` action. The files may be split across multiple transactions if they are too large to fit in a single transaction.

- *service*

  Service to upload to
  
- *dest*

  Destination path within *service*
  
- *source*

  Source directory to upload

- `-S`, `--sender` *sender*

  Account to use as the sender of the transaction. Defaults to the *service* account.
