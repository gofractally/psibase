# psibase-load-snapshot

## NAME

psibase-load-snapshot - Load a snapshot from a file

## SYNOPSIS

`psibase` `load-snapshot` *database* *snapshot-file*

## DESCRIPTION

`psibase load-snapshot` loads a snapshot from a file. If the database does not exist, it will be created. If the database already has a chain, the snapshot must be for the same chain.

## OPTIONS

- `-h`, `--help`

  Prints a help message

## SEE ALSO

[`psibase-create-snapshot`(1)](psibase-create-snapshot.md)
