# Git on Psibase

Primary approach: **keep separate instantiations**. Two ways to run git, with no shared data path.

1. **On-chain objects.** A `git` service stores refs and loose objects in the consensus database and serves them over ordinary HTTP (Hypertext Transfer Protocol). Stock `git clone` and `git fetch` work against that URL. Stock `git push` does not. Push goes through a git remote helper that signs a normal Psibase transaction. This is the instantiation to build. No node-local service is on this path. Local services cannot run git, and they are the wrong place to keep this repo.
2. **Node-hosted repo.** A sidecar on one machine stores a bare repo and speaks smart HTTP. The chain, if that deployment uses it, records ref hashes and not the objects. Compared in [The other instantiation](#the-other-instantiation). It is a different deployment, not a cache or a front end for the on-chain service.

**Full compose is deferred.** Compose would be one remote: the sidecar serves the bytes, the chain is the source of truth for the tip, and a push updates both. That needs a quarantine step, fork repair when the chain and the disk disagree, and a way to find which node has the objects. None of that is in this plan. Building either instantiation does not start it.

Roughly 6–10 weeks for one person who already knows Psibase: the on-chain service first, then the helper, then tests that drive real `git`.

Decided: the chain holds the full git objects as well as the refs. The node-hosted instantiation is kept separate for comparison and is not the chosen design. Full compose of the two stays deferred. The install script covers the client for this plan and, behind `--host`, the sidecar for the other instantiation.

The rest of this document specifies instantiation 1, except the comparison and the `--host` half of the installer.

## What a user can do

The on-chain URL looks like:

```text
http://git.<root>/<owner>/<repo>.git
```

For a local node that is `http://git.psibase.localhost:8080/alice/notes.git`. `<owner>` is a Psibase account. `<repo>` is a name stored in the service, not an account.

| Use | How | Supported |
| --- | --- | --- |
| Clone or fetch with stock `git` | `git clone http://git.<root>/alice/notes.git` | Yes, after the first commit exists. Git uses its dumb HTTP protocol: one request for the ref list, then one request per object. Comfortable for a small source repo. Miserable for tens of thousands of objects, because each object is a separate query. |
| Fetch again later | `git fetch` on that same URL | Yes. Same cost. |
| Push with stock `git` to that URL | `git push origin main` | No. Push requires the smart HTTP service `git-receive-pack`. This service does not speak it. |
| Clone, fetch, and push through real `git`, with a helper installed | `git clone psibase::http://<root>/alice/notes.git` | Yes. Requires `git-remote-psibase` on `PATH`. Push signs a transaction as a Psibase account. |
| Continuous-integration clone, no key | stock `git clone` of the HTTP URL | Yes. Reads are public. |
| Several writers, fast-forward only | owner adds writer accounts | Yes. A ref move names the oid it expects to replace. A non-fast-forward is rejected unless that account has force permission. |
| Force-push and delete a branch or tag | writer with that permission | Yes. The ref moves or disappears. Old objects stay in the database. |
| Annotated and lightweight tags | normal git tags | Yes. They are refs plus, for annotated tags, a tag object. |
| First commit into an empty repo | helper push, or a `psibase push` of the same actions | Yes. Cloning an empty repo with stock git over dumb HTTP is unreliable; do the first push with the helper, then the HTTP URL clones. |
| Import an existing repo | helper push | Yes, split across transactions when the new objects exceed one transaction. |
| Private repository | — | No. Every full node stores the objects. Hiding them from HTTP does not hide them from a node operator. |
| Git Large File Storage, shallow clone, partial clone | — | No. Those need either a side store or the smart HTTP negotiation this design does not implement. |
| Submodules | whatever URL the submodule uses | A submodule that points at another repo on this service is another dumb HTTP clone. Other URLs are git's problem. |
| Pull requests | POC web page on `git.<root>` | Minimal. A PR list (source branch, base branch, merge button). Merging happens in the browser and is refused when trees conflict. See [POC pull requests and merge](#poc-pull-requests-and-merge). |
| Review, browsing files in a browser | — | Out of scope. Setup is actions, not a web user interface. |

## On-chain service and node-local service

Psibase has two kinds of service.

**On-chain service.** Same code and same tables on every node. Tables live in the consensus database (`DbId::service`). Writes happen only inside a transaction. Reads happen from transactions and from HTTP queries. This is where the repository lives.

**Node-local service.** Name starts with `x-`. It exists on one node, is not available inside transactions, and stores data in the subjective database, which that node can wipe. `x-http` can send a subdomain to a local service before the on-chain server runs. Local services are still WebAssembly. A privileged one may read directories mounted with `psinode --mount`. None of them can start a host process.

`XDb::open` refuses `DbId::service`. A local service cannot read the git tables except by calling the on-chain service. It also cannot sign a user's transaction. A login token does not help: `POST /login` on `transact` returns a bearer token that `http-server` turns into the `user` argument of `serveSys`. That identifies the caller of a query. It is bound to the host that issued it, and it does not authorize a write. Writes are a fracpack-encoded signed transaction posted to `transact.<root>/push_transaction`.

So a local `x-git` would not be the repository, would not be the pack builder, and would not be the signer. This instantiation does not include one. A node operator should not register a local server on the `git` subdomain: that registration is tried before `http-server` and would hide the on-chain HTTP interface on that node only.

A native program that reads these objects and speaks smart HTTP in front of them is the deferred compose, not a follow-up on this service. This instantiation's HTTP API stays the dumb layout below.

## The `git` service

One user package. One account, `git`, installed by `root`.

`root` is required for that name. `Accounts::newAccount` rejects names shorter than 8 characters unless the name was preapproved in the same transaction, and the package installer only emits that preapproval when the sender is `root`. Short system accounts (`sites`, `tokens`) exist for the same reason. Installed by anyone else, the account name has to be at least 8 characters and the HTTP host changes with it.

On install the `git` account calls `http-server::registerServer`, so requests to `git.<root>` are dispatched to `git::serveSys`. Queries run in RPC (remote procedure call) mode: `serveSys` may read its tables and may not write them.

The package has no plugin. The only browser user interface is the POC pull-request page described in [POC pull requests and merge](#poc-pull-requests-and-merge).

### Tables

All of these are `ServiceTables` in `DbId::service`.

`RepoRow`, keyed by `(owner, name)`

- `owner`: account that created the repo
- `name`: repo name
- `default_branch`: full ref name, default `refs/heads/main`

`WriterRow`, keyed by `(owner, name, account)`

- `flags`: bit set, see Authorization

The owner is not stored as a writer. The owner has every flag.

`RefRow`, keyed by `(owner, name, refname)`

- `oid`: 20-byte SHA-1 object id

`ObjectRow`, keyed by `oid` only

- `data`: zlib-compressed loose object, the exact bytes a dumb HTTP client expects

Objects are global and content-addressed, same pattern as `SitesDataRow`. Two repos that contain the same blob store it once. The first transaction to write an oid pays for those bytes when disk billing is on (`Transact` bills `trxSender`). A later put of the same oid writes nothing.

The v1 proof of concept has no garbage collection. It never deletes objects, so a force-push leaves the old history on chain. GC that an admin can configure is deferred to later. Because the object table is shared across repos, that later design has to account for an object still being reachable from other repos.

### Actions

Every action's sender is the account that authorized the transaction. The service calls `get_sender()` and looks at its tables. It does not check signatures. The account's auth service already did that before the action ran.

`create(name)`

- Sender becomes `owner`.
- `name` matches `[A-Za-z0-9._-]`, is not `.` or `..`, and is stored without a `.git` suffix. The HTTP layer strips a trailing `.git`.
- Default branch is `refs/heads/main`. No ref row yet.

`setWriter(name, account, flags)` and `removeWriter(name, account)`

- Sender is the owner.

`putObjects(name, objects)`

- Sender is the owner or a writer with the update flag.
- `name` selects the repo for that permission check. The bytes are stored in the global object table.
- Each object is inflated, hashed, and stored under the computed id. The action rejects a mismatch, a bad header, or a type other than `blob`, `tree`, `commit`, or `tag`.
- SHA-1 only. The hash is SHA-1 of `type SP size NUL content`, which is the git loose-object rule. SHA-256 repositories are rejected.
- Does not check that trees point at known objects. That check is on the ref update, so objects may arrive in earlier transactions.

`updateRefs(name, updates)`

- Each update is `(refname, old_oid, new_oid)`.
- `old_oid` must equal the current ref. All zeroes means the ref must not exist yet. This is the compare-and-swap that makes two pushes race safely. The loser fails; the helper reports the error and the user fetches.
- Creating or fast-forwarding a ref requires the update flag. A non-fast-forward requires the force flag. Deleting (`new_oid` all zeroes) requires the delete flag. The owner has all three.
- A fast-forward means the new object is a commit whose parent chain reaches `old_oid`. Tag updates that are not fast-forwards need force.
- Before the refs are written, every object reachable from the new tips and not reachable from the old tips must already be stored: commit, tree, blob, and tag. A missing object rejects the whole action.
- Ref names are restricted the way git restricts them: under `refs/`, no `..`, no `@{`, no control characters. `HEAD` is not a ref row. It is `RepoRow.default_branch`.

`psibase push` can call these directly. The helper is a convenience over the same actions. A JSON (JavaScript Object Notation) action file for the CLI looks like:

```json
[
  {
    "sender": "alice",
    "service": "git",
    "method": "create",
    "data": { "name": "notes" }
  }
]
```

`psibase push -s <key> actions.json` loads the service schema, packs `data`, signs, and posts the transaction. Large object bodies should not go through that JSON form: hex in `rawData` doubles them. The helper posts a packed signed transaction to `/push_transaction` instead.

### What `serveSys` responds to

Dumb HTTP, as specified by `gitprotocol-http`. Git's smart discovery is `GET <repo>/info/refs?service=git-upload-pack`. A dumb server answers that with the plain ref list, and the content type must not start with `application/x-git-`. Git then reuses that body and walks loose objects. This service always does that. It never returns `application/x-git-upload-pack-advertisement`.

`<repo>` in the paths below is `/<owner>/<repo>` with an optional `.git` suffix removed.

| Request | Response |
| --- | --- |
| `GET <repo>/HEAD` | `200`, `text/plain`, body `ref: refs/heads/main\n` using the repo's default branch |
| `GET <repo>/info/refs` and the same path with `?service=git-upload-pack` or `?service=git-receive-pack` | `200`, `text/plain; charset=utf-8`. One line per ref, `oid TAB refname LF`, sorted by ref name in the C locale. Annotated tags also get a peeled line, `oid TAB refname^{} LF`. `HEAD` is not listed. `Cache-Control: no-cache`. |
| `GET <repo>/objects/<2 hex>/<38 hex>` | `200`, body is `ObjectRow.data` unchanged. `404` if that oid is not stored. |
| `GET <repo>/objects/info/packs` and `POST <repo>/git-upload-pack` and `POST <repo>/git-receive-pack` | `404`. No packs are stored. Push has no endpoint here. |

Reads are not authenticated. `serveSys` receives the logged-in account when the request carries a bearer token or a `__Host-SESSION` cookie, and v1 ignores it. The bytes are on every full node anyway.

There is no pack file. A dumb client that finds no `objects/info/packs` fetches each loose object by its path. That is the whole fetch implementation inside the service: a table read copied into an `HttpReply`. One object per response, and each object already had to fit in a transaction, so the reply is small.

## Authorization

Two different mechanisms, and only one of them guards a write.

**Query identity.** `http-server` passes the logged-in account into `serveSys` as `user`. The token comes from `POST /login` on `transact`: a signed login transaction with `do_not_broadcast` set, not an executed action. `RTransact::login` builds a token for that sender, audience equal to the root host, expiry 30 days, signed with a key that lives in the subjective database of that node. `RTransact::getUser` accepts it as `Authorization: Bearer` or the `__Host-SESSION` cookie. Useful for "who is looking." Not a signature over `putObjects`.

**Transaction authority.** The writer runs a transaction whose action sender is their account. Before `git` runs, that account's auth service checks the claims and proofs on the transaction. For an `auth-sig` account, the claim names the account's key and the proof is the signature. `git` then applies the rules below. An account that uses some other auth service still works, as long as the client that builds the transaction can produce the proof that service requires. The v1 helper only produces `auth-sig` proofs, the same key formats as `psibase push --sign`: a PEM or DER private-key file, or a PKCS #11 URI.

Permissions on a repo:

| Flag | Allows |
| --- | --- |
| update | `putObjects`. Create a ref. Fast-forward a ref. |
| force | Move a ref to something that is not a descendant of the current tip. |
| delete | Delete a ref. |

The owner always has all three flags and is the only account that can call `setWriter` or `removeWriter`. A writer who is not the owner cannot grant access to anyone else.

Disk cost, when resource monitoring is enabled, is charged to the transaction sender. A writer uploading into someone else's repo pays for new objects. Duplicate oids are not charged again. This is the quota: junk objects cost the sender, and the writer check stops random accounts from writing the table at all.

## The remote helper

A native program named `git-remote-psibase` on `PATH`. Git invokes it for any remote whose URL starts with `psibase::`. It is not part of the wasm package. A wasm subcommand cannot shell out to git, and the helper's job is to let git do the object work locally.

URL form:

```text
psibase::http://psibase.localhost:8080/alice/notes
```

The helper strips the `psibase::` prefix and talks to `http://git.<host>/alice/notes.git` for reads, and to `http://transact.<host>/push_transaction` for writes. The host in the URL is the node API (application programming interface) root, not the `git` subdomain. The account whose key signs pushes is a helper option, defaulting to `<owner>`:

```text
git clone -c psibase.account=alice -c psibase.key=/path/to/key.pem \
    psibase::http://psibase.localhost:8080/alice/notes
```

The key never leaves the client. The node receives a signed transaction.

Helper operations, the ones git actually calls:

- `list` — `GET` the dumb `info/refs` and print `<oid> <ref>`.
- `fetch` — download the loose objects reachable from the requested tips and feed them to local git (`git unpack-objects`, or write loose files under the git dir git passed in). Skip any oid `git cat-file -e` already has.
- `push <src>:<dst>` — in the local repo, `git rev-list --objects <old>..<new>` and `git cat-file --batch` produce the new loose objects. Group them into `putObjects` transactions. The last transaction is `updateRefs` with the `old_oid` the helper just read. Post each one with `wait_for=applied`. If the compare-and-swap fails, print the trace and exit non-zero so git reports a rejected push.

Signing and posting use the same path as `psibase push`: build the actions, sign with the `--sign` key, `POST` the packed bytes to `/push_transaction` as `application/octet-stream`. Shelling out to `psibase push -s` is fine for `create` and `setWriter`. It is a poor fit for objects, because the CLI's JSON action file carries either schema-shaped JSON or hex `rawData`.

Configuration actions (`create`, `setWriter`) are `psibase push` of a JSON file. No web UI.

## Size limits

These are properties of the chain, not of git.

- `psinode` caps an HTTP request body at 20 MiB (`max_request_size`).
- A packed block has a hard ceiling of 16 MiB in triedent. When resource monitoring is off, `RTransact` also stops adding transactions once the current block reaches a soft budget of 8 MiB.
- One `HttpReply` is a single buffer. There is no streamed body. That is fine, because v1 never builds a pack.

Each object is capped at 1 MiB (inflated size), and `putObjects` rejects anything larger. The cap applies to each object, not to a push or the transport. A push can carry an 800 KiB object plus many tiny ones. The helper spreads objects across as many `putObjects` transactions as it needs to stay inside the block budget. That rules out large binaries. Source trees of small files are the intended contents.

The reachability walk in `updateRefs` has to finish inside the transaction's CPU budget. A first import of a repo with a long history is many `putObjects` transactions and one `updateRefs` that walks only the newly reachable set. If that walk is too expensive for one transaction, the import has to land as several ref moves (push an intermediate commit, then a later one), not as one jump from empty to a huge tip. The helper can do that when a single `updateRefs` fails for resource limits.

## Why the service does not speak smart HTTP

Smart HTTP is what `git push https://…` and efficient `git clone` use. The server advertises refs as pkt-lines (`Content-Type: application/x-git-upload-pack-advertisement`), then the client posts a want/have negotiation and the server answers with one pack. Packs are delta-compressed. Git clients send thin packs on push, so a server that accepts stock `git push` must resolve deltas.

That code already exists in git, libgit2, and gitoxide. Running it inside the `git` service, or inside a local service, means compiling it to the service target and finishing a pack inside a query or a transaction watchdog, then returning the whole pack as one `HttpReply`. A small repo might fit. The implementation cost and the failure mode (a clone that works until the repo grows) are a bad trade against dumb HTTP, which is already specified, already implemented in git, and maps onto a table read.

Unmodified `git push https://…` against this service would be the deferred compose: a native front end speaking smart HTTP and still writing `putObjects` and `updateRefs`. That is not a later phase of this instantiation. The service API stays the dumb layout.

## What is reused

- Stock git for clone and fetch. No protocol code in the service beyond the dumb file layout.
- Stock git inside the helper (`rev-list`, `cat-file`, `unpack-objects`) for deciding which objects are new and for storing fetched objects.
- A zlib crate and a SHA-1 crate in the service. Both are normal dependencies for the wasm target. The check is: inflate, hash, parse the header, and on ref update walk commits and trees. That is hundreds of lines, not a git port.
- `auth-sig`, `http-server`, and `transact`. The service does not grow a new login or signature scheme.
- The `sites` pattern: content-addressed blobs in one table, per-account names beside them, HTTP served by the account that registered with `http-server`.

Not used in v1: libgit2, gitoxide, `git-http-backend`, Radicle. Those matter for a native smart-HTTP front end. They do not belong in the package.

## Build order

1. Tables, `create`, `setWriter`. Install as `root` onto a local node and confirm `git.<root>` is routed to the service.
2. `putObjects` with inflate-and-hash. `updateRefs` with compare-and-swap, fast-forward, and the reachability walk.
3. `serveSys` for `HEAD`, `info/refs`, and loose objects. `git clone` of a repo that was pushed with `psibase push` must succeed with an unmodified git.
4. `git-remote-psibase` push, then fetch, against the same node.
5. Tests: second clone sees the push; a fast-forward from a second writer lands; a non-fast-forward without the force flag fails; two updates with the same `old_oid` produce one success and one rejected transaction; an object whose bytes do not match its id is rejected; a ref that points at a missing blob is rejected.

> **Implementation notes (V1 POC, `packages/user/Git`, `rust/git-remote-psibase`).** Where the code differs from the text above:
> - `putObjects(owner, name, objects)` and `updateRefs(owner, name, updates)` take the repo `owner` explicitly, so a writer can target someone else's repo. Each object is `{oid, data}`: the claimed id is checked against the computed hash, which is what makes "bytes do not match its id" rejectable.
> - Oids are stored and passed as 40-char lowercase hex strings, not 20 raw bytes.
> - The reachability walk in `updateRefs` stops at any oid that is already a ref tip in the same repo (its closure was checked when that ref was written), instead of computing the full set reachable from the old tips.
> - The helper posts the final `updateRefs` transaction with `wait_for=final`, not `applied`, because HTTP queries read committed state and an immediate second push would otherwise see stale refs and lose the compare-and-swap. Earlier `putObjects` transactions use `applied`. Batches are capped at about 3 MiB of compressed objects per transaction.
> - Helper account and key lookup order: `PSIBASE_GIT_ACCOUNT` / `PSIBASE_GIT_KEY`, then git config `psibase.account` / `psibase.key`, then `~/.psibase.toml` `[git.<name>]` where `<name>` is the `[hosts]` alias whose URL matches the remote root, or the remote's `host:port`. Account defaults to the repo owner. The node comes from the remote URL itself, not `-a`/`PSINODE_URL`.
> - Tests are `packages/user/Git/test/git_e2e.py`, run against a live local psinode rather than the service tester.

## The other instantiation

This is a second deployment, not a mode of the on-chain service. Nothing here reads `ObjectRow` or serves `git.<root>` from chain state. A chain can run one instantiation, the other, or both, and a repo lives in exactly one of them.

The on-chain `git` account in this instantiation stores the repo record, the writers, and each ref's object id. It does not store blobs, trees, or commit bodies. A node that hosts the repo keeps a normal bare repository on its own disk and runs a native sidecar that speaks git's smart HTTP. After a push, the sidecar submits `updateRefs` so the chain's hash moves to the new tip.

`x-git` belongs to this instantiation only. It records, in the subjective database, which repos this node is hosting and where their directories are. That database is the right place for that bookkeeping: it is node-private, and the node may wipe it. It is the wrong place for the only copy of the objects. The object bytes belong on the sidecar's disk.

`x-git` still cannot be the program clients talk git to. Local services are WebAssembly, the mount API is `readFile` only, and they cannot start a process. `git http-backend` runs in the sidecar. `psinode` also has no hook that hands a subdomain to a host process, and an `x-http` registration only overrides the subdomain on that one node. Clients of this design use the sidecar's own URL.

What the chain checks is the signature and the ref rules (who may move it, and the compare-and-swap on the previous id). It cannot check that the new id is a real commit, or that any node still has the tree. Those bytes never enter the transaction. A writer can point `main` at 20 arbitrary bytes with `psibase push`, skipping the sidecar. The sidecar is what refuses to publish a tip it cannot serve. The chain is a signed pointer.

### Feature

**On-chain objects**

Pros

- Any node that has the chain can serve the repo. The clone URL is a property of the chain, not of a machine that happens to be up.
- A push that lands is still there after the node that accepted it goes away. A fork rolls the objects back with the blocks.
- The id on a ref was checked against the bytes in the transaction. A clone that succeeds got the tree the chain committed to.
- Reads need no extra install. Continuous-integration clones with stock git.

Cons

- Fetch cost grows with the number of objects. A large history is a long series of queries.
- Stock `git push` to the chain URL does not work. The helper is required.
- A blob has to fit in a transaction under the block budget. Large binaries and long imports are out.
- Every full node stores every byte for as long as the chain does. There is no private repo, and a force-push does not free the old history.

**Hashes on chain, bytes on a host**

Pros

- Against the host that has the bare repo, stock git works: `git clone`, `git fetch`, and `git push`, with packs, thin packs, and incremental fetch. Shallow and partial clone work to the extent git's own server supports them.
- Repo size is the host's disk. A push of a large tree is one small chain transaction plus a pack the chain never sees.
- Full nodes that are not hosting the repo store ref names and hashes, not source. Other operators do not receive the file contents. The hosting operator does.
- The host can garbage-collect objects the current refs no longer reach.

Cons

- The clone URL is the host. Pointing git at some other node on the same chain yields the hash and no objects.
- If the host loses its disk and nobody else mirrored the repo, the chain still names the tip and no one can clone it. The hash is not a backup.
- After garbage collection, the chain can still show that a ref used to name an id, and that id may no longer be fetchable anywhere.
- Writers have to share a host, or the hosts have to replicate. Two people pushing at two machines get a chain winner and a loser whose pack is not the tip. The loser can pull only if some host still has the winner's objects.
- The chain will accept a ref update for bytes that exist nowhere, because the transaction does not contain them.

### Implementation

**On-chain objects**

Pros

- One WebAssembly service and one client binary. The node operator installs the package and does not supervise another process.
- Replication, forks, and "which node has the data" are the chain's existing job. A failed transaction leaves no disk to roll back.
- Authorization is `get_sender()` on the transaction that contains the bytes.
- Tests are the service tester plus real git. One process.

Cons

- The service still has to inflate, hash, walk trees, serve dumb HTTP, and split large pushes. That is the custom code.
- The block budget and the single-buffer HTTP reply stay in the design. Adding a native smart-HTTP front later does not remove them, because the bytes still have to enter a transaction.

**Hashes on chain, bytes on a host**

Pros

- The on-chain service shrinks to repo rows, writer rows, and ref ids. No object table, no inflate, no reachability walk, no 1 MiB chunking.
- The sidecar shells out to git (or links libgit2) and gets the pack protocol, deltas, and thin packs from that code.
- `x-git` is a small local package: the subjective list of hosted repos. It is not on the data path of clone or push.

Cons

- The sidecar is a second runtime. Someone has to install it, keep it running, back up its disk, and upgrade git. The client install script does not do that on the server.
- A push is a pack on disk and a transaction on chain, and those can diverge. The sidecar should quarantine the pack, submit `updateRefs`, and publish the bare repo only after the transaction is applied. If the chain forks, the disk does not roll back by itself. The sidecar has to watch the ref rows and reset the bare repo to the chain tip. That reset logic has no counterpart in the on-chain-objects design.
- There is no built-in way to publish the sidecar on `git.<root>`. It listens on its own port, or the operator puts a reverse proxy in front of it.
- Multi-host replication is extra: fetch from a peer, check the objects against the chain's id, then serve them. Until that exists, one host is a single point of failure.
- Tests need `psinode`, the sidecar, and git.

For a single host and no replication, the two instantiations are similar in calendar time. The on-chain service is most of the one this document builds. The sidecar and its fork handling are most of the other. The other grows by replication and discovery the moment more than one node should serve a repo. The on-chain instantiation pays for replication inside the chain and spends its effort on size limits instead.

Wiring them so one push writes chain objects and a local bare repo, or so the sidecar is a smart-HTTP front for `ObjectRow`, is the deferred compose. Do not add that path while building either instantiation.

## Installing the client

Users install the client for the on-chain instantiation with one script. The same tarball carries the sidecar binary for the node-hosted instantiation. Default mode does not install or start the sidecar, and installing both binaries does not compose the two deployments.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://<release-host>/psibase-git/install.sh | sh
```

Node operators who are running the sidecar add `--host`:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://<release-host>/psibase-git/install.sh | sh -s -- --host
```

The script is the whole installer. It does not hand off to a package manager.

- Default prefix is `$HOME/.local`. `--prefix <dir>` overrides it. If `bin` under that prefix is not writable, the script exits and tells the user what to pass. It does not call sudo.
- It refuses to run as root unless `--prefix` was set explicitly, so a piped install does not drop binaries into a root home by accident.
- It requires `git` on `PATH` and exits with that message if it is missing. It does not install git.
- It selects a release tarball from the OS and architecture (`linux` `x86_64` and `linux` `aarch64` at first), downloads the tarball and its SHA-256 checksum, and checks the checksum before extracting.
- It installs `git-remote-psibase` into `<prefix>/bin`. Git finds remote helpers by name on `PATH`, so if that directory is not on `PATH` the script prints the export line and stops short of claiming success.
- The helper signs and posts transactions itself, with the same key formats as `psibase push --sign`. The script does not install the `psibase` CLI and does not need it.
- `--host` also installs `psibase-git-host` into the same `bin`. It does not start it, enable a service unit, or open a port. It prints the run command: `psibase-git-host --api http://<root> --repo-dir <prefix>/share/psibase-git/repos`.
- Re-running the script replaces the binaries at the same paths.

The on-chain instantiation's users run the script with no flags and then use `psibase::` URLs. `--host` is the other instantiation's binary, present so that deployment does not grow a second installer. Running both on one machine still leaves two remotes.

## Most Likely Pragmatic Design

On-chain git as above, with large files moved to Git LFS on a server the user chooses.

- Each repo row carries an optional LFS endpoint URL. The API key for that server never goes on chain. It lives in the user's local git config or credential helper, and `git-lfs` sends it to the LFS server directly.
- The chain stores only small LFS pointer files (oid and size). The bytes live on the user's LFS server. Psibase does not host, bill, or replicate them.
- `putObjects` rejects any object whose inflated size is over 1 MiB. This is a per-object cap, not a per-push limit. Anything larger has to be tracked by LFS. The helper checks this before signing. When a staged blob is over the limit and is not an LFS pointer, it fails with a message naming the file and the `git lfs track` command to fix it.
- Clone and fetch still work with stock git plus `git-lfs`. Without LFS access, a clone gets the source tree and the pointer files, but not the large files.

This keeps every on-chain object well inside the transaction budget in [Size limits](#size-limits). Media and binaries stay off the chain, and no node has to run storage infrastructure. The tradeoff is that large files are only as available as the user's LFS server. They are not covered by consensus.

## Repo authorization with AuthDyn

Each repo gets its own Psibase account (for example `admin-hash`). That account owns the repo row and is the account that signs `putObjects` and `updateRefs`. Group control then comes from the account's auth service, so the `git` service does not need its own writer model.

- The repo account sets `auth-dyn` as its auth service and calls `set_mgmt` to name a policy manager service.
- The policy manager returns a `DynamicAuthPolicy` for the account: a list of member accounts, each with a weight, plus a threshold. Any subset of members whose weights reach the threshold can authorize a push. Members at weight 1 with threshold 1 lets any one member push. Threshold 2 needs two members.
- `get_policy` receives the service and method, so the policy can differ per action. For example, `updateRefs` with the force flag can need a higher threshold than a fast-forward.
- When a push needs more than one signer, it goes through `staged-tx`. Members approve the staged transaction, and it executes once the approved weight reaches the threshold. Enough rejections cancel it.

`auth-delegate` is not the right fit. It lets one owner account sign for another, and nothing more. It cannot express a group or a threshold.

## POC pull requests and merge

The POC adds a minimal web page on `git.<root>`.

- A PR list per repo. Each entry has a source branch, a base branch, and a merge button.
- Merging happens in the browser. The page fetches the objects over the same HTTP URLs that stock git uses. It computes the merge tree and commit client-side, then signs and submits one transaction. That transaction calls `putObjects` for the new tree and commit objects and `updateRefs` to move the base branch, with the base's current oid as `old_oid`.
- No merge conflict handling. When both sides changed the same path, the merge button refuses and tells the user to resolve locally and push first. There is no rename detection and no conflict editor.

## CLI

To the user, the git CLI looks like a typical git CLI: `git clone`, `git fetch`, `git push` against a `psibase::` remote.

One-time setup is editing `~/.psibase.toml`. For each host, it sets a default account and a default key. The key is a PEM or DER private key file path, or a PKCS #11 URI. The node comes from `-a` or `PSINODE_URL`, which defaults to the local node (`http://psibase.localhost:8080/`). Named hosts are saved in the same file (`psibase config set hosts.<name> <url>`).

```toml
[hosts]
prod = "https://prod.example.com"

# new: per-host defaults for the git helper
[git.prod]
account = "alice"
key = "pkcs11:token=...;object=..."   # or a path to a PEM/DER key file
```

The remote URL lives in normal git config as a `psibase::` URL (`git remote add origin psibase::https://prod.example.com/alice/notes.git`), so git itself stores the host and repo. Git cannot pass extra flags to a remote helper, so `git-remote-psibase` picks up the account and key from `~/.psibase.toml` or the environment.

Signing reuses the existing `psibase` CLI path, which already signs with a key file or a PKCS #11 token (`--sign`). Node-local keys in `x-keys` are out of scope for now.

## Out of scope for this plan

Browser UI beyond the POC pull-request page, and merge conflict resolution in the browser. Full compose of the two instantiations: one remote whose bytes live on a host and whose tip is chain state, including quarantine, fork repair, and multi-host discovery. A smart-HTTP front end over the on-chain object table is that compose, not a phase of instantiation 1.

For the on-chain instantiation specifically: a node-local object cache, smart HTTP, packfiles, deleting history, private repos, Large File Storage, and shallow or partial clone. Those last items exist only in the node-hosted instantiation, and only from a machine that is actually hosting that repo. Git LFS, in [Most Likely Pragmatic Design](#most-likely-pragmatic-design), is the user's own server, not a Psibase-hosted store.
