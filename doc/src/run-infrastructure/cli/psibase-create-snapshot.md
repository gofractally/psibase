# psibase-create-snapshot

## NAME

psibase-create-snapshot - Write a snapshot to a file

## SYNOPSIS

`psibase` `create-snapshot` [`-b`] [`-s` *key-file*\.\.\.] *database* *snapshot-file*

## DESCRIPTION

`psibase create-snapshot` writes a snapshot of the chain state to a file. The snapshot will hold the the most recent state that is signed by the block producers.

## OPTIONS

- `-b`, `--blocks`

  Include the block log in the snapshot. This will make the block log available for queries.

- `-z`, `--gzip`

  Compress the snapshot with gzip.

- `-h`, `--help`

  Prints a help message

- `-s`, `--sign` *key-file*

  Signs the snapshot with this key. The file should contain a PKCS #8 private key.

## SEE ALSO

[`psibase-load-snapshot`(1)](psibase-load-snapshot.md)
