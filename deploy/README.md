# Deploying a psibase node

`deploy.py <config.json> <mode>` is the one way a deployment is brought up and changed
(gofractally/psibase#2308). A deployment is described by a configuration file kept here
(`psiber.net/config.json` is the public test node) and by a directory of secrets kept
outside the repository, which the configuration names. Run `deploy.py` with no arguments
for the list of modes.

## What is in the configuration and what is not

In it: host name, network name, producer, the commit that is deployed, the package sets,
which packages are node-local and which must be installed together, node options, the
proxy's operator hosts, the bridge's parameters, and the command of every process.

Not in it, read from `paths.secrets` and never printed or created for you:

| File | What it is |
|---|---|
| `block.key.pem` | the operator's block-signing key (secp256k1, PEM) |
| `<producer>.key.pem` | the producer account's key |
| `signup-config.json` | x-signup's providers with their OAuth client secrets |
| account keys | treasury, liquidity, relayer, bots |

The bridge's three signing daemons keep their own key files and journals in the
deployment's `bridge-state/secrets`; `backup` copies them. **A backup on the same machine
is not a backup**: copy it elsewhere.

## Modes

- `status`, `start`, `stop`: every process (node, proxy, signing daemons, relayer, bots)
  runs under a `systemd --user` unit that restarts it. Units outlive a logout only with
  lingering (`loginctl enable-linger <user>`, once, as root).
- `verify`: node answers; an unsigned transaction from root is refused; network name;
  `guest` has one key and no partner; through the proxy, the sign-in page is served, a
  signed-out visit is sent to it, and the operator hosts answer 404; the bridge and relay
  are not paused, reserve equals liability, the relay follows the Bitcoin tip.
- `backup [--with-db]`: secrets, bridge state and a snapshot of the bridge's books. A
  copy of a running node's database is not a snapshot, so `--with-db` stops the node,
  copies and starts it again.
- `upgrade PKG...`: installs packages from the build, signed with the block key; keeps the
  replaced packages in `previous-packages/`; installs together what only works together;
  restores the network name after Homepage; compares the bridge's books before and after
  and stops if they differ.
- `boot`: a new chain. See below.
- `record`: appends commit and installed package versions to `deployments.jsonl`.

## Booting a new chain

`boot` refuses while a chain exists in the deployment directory, and refuses outright
while that chain's bridge holds a reserve, escrow or open withdrawals. The bridge's
signers control real (test) Bitcoin: see "Moving to a new chain".

What it does: installs the built binaries and packages; starts the node; gives the node
the operator's block key; boots with `--block-key` and the producer's key; installs the
packages listed for after boot; sets the network name; gives x-signup its configuration;
starts everything. Seeding that belongs to one deployment (tokens, markets, the bridge's
initialisation with `demo/btcbridge/deploy_live.py`) is run after it.

## Things learned by hand, which the script now does or checks

- A chain booted without `--block-key` accepts **unsigned transactions as `root`**. The
  node must be given a key the operator holds, not one it generates (the operator is
  otherwise locked out of every later install). `verify` checks an unsigned root
  transaction is refused.
- After that, package installs are signed with the block key and the producer's key.
- A node-local package (`X*`) is installed with `--local`, and an install that mixes local
  and chain packages is refused as a whole.
- Supervisor and CommonApi are installed together; HttpServer, XSignup and Supervisor
  together (the sign-in gate).
- Reinstalling Homepage resets the network name to `network`.
- The `guest` account on an existing chain is created by upgrading AuthSigService (#2307).
- UI packages built outside the normal build (`BtcBridge`, `Exchange`) need `npm ci`
  before `npm run build`; a package whose declared UI directory is missing is refused.
- The reverse proxy answers the operator hosts with 404 from outside, and offers this
  machine's own services a loopback port that passes the sign-in gate as the operator.
- An in-place upgrade of a service that holds funds is rehearsed first on a loopback chain
  in the same state, and its books are compared before and after on the live chain.

## Moving to a new chain

Not automated, deliberately. Either every holder withdraws and the bridge's reserve is
swept to an address the operator controls before the old chain is retired, or a new
bridge is initialised on the same signer keys so that it controls the same outputs. The
second is untested; do it on a loopback chain first.

## Not yet in the script

Building (`build` mode: checking out the configured commit and building it), writing the
proxy configuration from the configuration file, and the deployment-specific seeding
steps are still done by the commands recorded on #2308.
