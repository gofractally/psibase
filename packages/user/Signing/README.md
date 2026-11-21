# Generic signing service

`signhash` is a Psibase service for owner-authorized cryptographic operations.
It has no dependency on the Bitcoin bridge. Its separate Rust daemon depends on
`signing-core`, HTTP, local file locking, and the Psibase CLI. It does not import
the Bitcoin library and does not contact Bitcoin nodes or explorers.

## Contract interface

1. An application calls `newKey(provider)`. The service records the calling
   account as the immutable owner and allocates a key ID.
2. After the request is irreversible, the selected provider publishes an
   extended public key with `publishKey`. Publication requires that provider's
   Psibase authority. A published key cannot be replaced.
3. Only the owner can call `requestHash(key, path, hash)`. The digest is exactly
   32 bytes. `path` optionally identifies public, non-hardened descendants.
4. The provider waits for the request to become irreversible, derives the
   requested private key, signs exactly that digest, and calls `publishSig`.
5. The service verifies the ECDSA signature against the derived public key and
   requested digest before storing it. Any participant can relay a valid result.

Version 1 supports **secp256k1 ECDSA prehash signing**, canonical low-S signatures
encoded as 64-byte `r || s`. The application supplies protocol-specific hash
construction and signature encoding. For example, BTC Bridge computes BIP143
sighashes and converts responses to DER with a SIGHASH_ALL suffix. Attestation
applications must put their own chain, domain, nonce and message commitments
inside the digest where their protocol requires them. The generic service must
not change the digest because that would invalidate external protocol signatures.

Each key ID selects a hardened branch of the provider's independent master
seed. Public derivation below an application key cannot cross into another
application's hardened branch. No private key is published on chain.

## Security boundary

The application contract is the spending/attestation authority. The daemon does
not second-guess its transaction policy. A bug or malicious upgrade in that
contract can authorize an unwanted digest; a valid finalized request will be
signed. Requests whose signatures may have escaped cannot safely be revoked.

Each production provider must validate Psibase consensus/finality using its own
trusted node, pin the signing deployment identity, and protect its own secret.
A remote endpoint's JSON claim about finality is not a cryptographic finality
proof. The daemon rejects stale chain timestamps, mismatched deployment/key
identities, and mutation of previously observed finalized requests. Its journal
is flushed before signature publication, and an OS lock prevents concurrent use
of the same journal. Provider queues use separate pending indexes and bounded
read pages. Provider resource pricing/admission and hardware key backends remain
production integration work; do not expose an unfunded daemon to arbitrary
request volume.

The included file-based backend is for the isolated regtest demonstration.
Keys and journals are mode 0600 under a mode 0700 directory. All three demo
providers run on one machine; genuine 2-of-3 independence requires separate
operators and machines.

## Daemon

```sh
cargo build --manifest-path packages/user/Signing/daemon/Cargo.toml \
  --target aarch64-apple-darwin --target-dir packages/user/target
packages/user/target/aarch64-apple-darwin/debug/signing-daemon generate PRIVATE_DIR
packages/user/target/aarch64-apple-darwin/debug/signing-daemon watch CONFIG.json
```

`generate` creates three disposable secrets and a public deployment ID. The
`demo/btcbridge/run.py` helper writes the matching configurations without printing
secrets. Configuration contains the trusted node URL/Host, Psibase CLI path,
provider account, custody-secret path, Psibase authentication-key path (`auth_key_path`), deployment identity and journal path. Publication is signed with that provider’s separate Psibase account key. It
contains no Bitcoin network, transaction, fee or UTXO settings. Replace the
native target above when building on another platform.
