# x-basic

This service manages HTTP Basic Authentication.

The environmental variable `PSIBASE_PASSWD_FILE` is the name of a file containing a list of users in htpasswd format. The file must be readable by services (See the [--mount option](../run-infrastructure/cli/psinode.md#general-options)). Only the bcrypt algorithm is supported.

## Example password file

```
alice:$2b$05$pUj4k4rx0XUjB4ZY5dy55u.E5acDwODRjl6sWtNkY1hH535rjQUNy
bob:$2b$05$tfaV7RW0inop8/c4Mp7soOCcwYeC12tchfTlKd65nTSsJ7NpGsz2G
```
