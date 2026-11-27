# auth-sig

# Actions

{{#cpp-doc ::SystemService::AuthSig::AuthSig}}

# Tables

{{#cpp-doc ::SystemService::AuthSig::AuthRecord}}

# The guest account

Every chain has an account named `guest` that nobody can authorize. It exists so that a visitor who is not signed in can be presented to apps as an account, and an app always has a current user. (Presenting visitors that way is the wallet's part and is not described here.)

`guest` is an ordinary account. It uses `auth-sig` like any other; no service, and nothing in the node, looks at the name. What makes it nobody's account is its record alone:

- Its owner key and its active key are the same secp256k1 public key, for which no private key is known. `verify-k1` treats it as the ordinary key it is; no signature verifies with it.
- It has no recovery partner. Everything in `auth-sig` that changes an account's keys, pauses it, freezes it or releases it needs the owner key or the recovery partner, so none of it can happen.

So a transaction from `guest` is refused for lack of authorization, as it is for any account whose key the sender does not hold. As a recipient it is like any other account: what is sent to it is held by an account that nobody controls. A token credit, for example, stays a pending credit that the sender can still take back, because the account can never accept it.

## The key

The key is not a constant somebody chose. It is derived from a sentence, so that anyone can see that it was not made from a private key:

```text
x = SHA-256("psibase guest account: nobody holds this key" || counter)
```

with the counter as 4 bytes, little-endian, starting at 0 and counted up until `x` is the x-coordinate of a point of the curve. The key is that point with the even y. The first counter that gives one is 0:

| | |
|---|---|
| point (compressed) | `029ae2e83237cfbe0037e80f6098c6cae957e8f024fcb8bb4221f67461208b0710` |
| SubjectPublicKeyInfo (DER) | `3036301006072a8648ce3d020106052b8104000a032200029ae2e83237cfbe0037e80f6098c6cae957e8f024fcb8bb4221f67461208b0710` |
| fingerprint (SHA-256 of the DER) | `58be7657f21e26fba9bf86a08bb0069a2f7f3bad34b87a2924b4fa611de10053` |

secp256k1 has prime order, so every point of the curve is an ordinary public key; signing for this one means finding its discrete logarithm.

To check it, without any psibase code:

```sh
printf 'psibase guest account: nobody holds this key\0\0\0\0' | openssl dgst -sha256
# 9ae2e83237cfbe0037e80f6098c6cae957e8f024fcb8bb4221f67461208b0710
```

`packages/system/AuthSig/guest-key.py` states the whole derivation with integer arithmetic (that the x is on the curve, that the point has the full order) and writes `guest-key.json`; `guest-key.py --check` fails if that file, the boot actions or the C++ constants (`services/system/GuestAccount.hpp`) differ from what it derives. To check a running chain, compare what `auth-sig` reports:

```sh
curl -s -H 'Content-Type: application/graphql' \
  -d '{ account(name: "guest") { owner { verifier key seq } active { verifier key seq } partner state pending { kind } priorOwners { expires } } }' \
  https://auth-sig.NETWORK/graphql
```

The answer must have this key (as PEM) as both `owner.key` and `active.key`, `verify-k1` as both verifiers, `partner` null, `state` `normal`, `pending` null and no `priorOwners`:

```text
-----BEGIN PUBLIC KEY-----
MDYwEAYHKoZIzj0CAQYFK4EEAAoDIgACmuLoMjfPvgA36A9gmMbK6Vfo8CT8uLtC
IfZ0YSCLBxA=
-----END PUBLIC KEY-----
```

## How it is created

The `AuthSigService` package creates it when it is installed, with two actions (`packages/system/AuthSig/postinstall.json`):

1. `accounts::newAccount("guest", "auth-sig", matchExisting)`, sent by `accounts`, the one account that may create a name this short. The account then exists, uses `auth-sig` and has no keys: nothing can authorize it.
2. `auth-sig::initKeys("guest", key, key)`, sent by `auth-sig`. It gives keys, and no recovery partner, to an account in exactly that state, and never changes a record that exists.

`initKeys` is not about `guest`: it names no account. The service's own account can give keys, and no recovery partner, to any account that points at `auth-sig` and has no record there yet. An account gets into that state only when `accounts::newAccount` is called with `auth-sig` as the auth service directly; `accounts::setAuthServ` refuses to move an account to `auth-sig` before it has keys. This gives whoever controls the `auth-sig` account nothing they could not do anyway by replacing the service.

It is not created with `auth-sig::newAccount`, which makes the creator the recovery partner: a partner can install new keys in a frozen account, and only the owner key can remove a partner. Every package set that includes `auth-sig` therefore has the account from the first block: `DevDefault`, `ProdDefault`, `ProdWithFG`, `PrivDefault` and `TestDefault`. `Minimal` has neither `auth-sig` nor accounts for people, and does not have it.

Both actions may be repeated; they do nothing if the account is already as they would make it, and fail if `guest` exists in any other form.

What this does not cover: the accounts that govern the chain can rewrite anything. Whoever controls `root` can replace the code of `auth-sig` or `accounts`, can have `accounts` suspend any account (`accounts::freeze`), and, acting as the `auth-sig` service account, can run an action as any account that uses `auth-sig` (`transact::runAs`), `guest` included. That is true of every account on the chain, and nothing about `guest` changes it.

## On a chain that is already running

A chain booted before this account existed gets it once, from its operator. The transactions are sent as `accounts` and `auth-sig`, which the producers control through `root`: sign with the key that authorizes `root` on that chain (the producer's block signing key, on a chain with one producer).

1. Check that the name is free, before upgrading anything. This must print `null`; if it prints an account, stop: somebody holds the name, and that has to be resolved first. The upgrade of `AuthSigService` in the next step fails as a whole, service code included, if `guest` exists with another auth service, or with `auth-sig` and other keys or a recovery partner. An ordinary account cannot have created a name of 5 characters: it takes `accounts` itself or a name the name market has released, so in practice it is the chain's operator who would know.

   ```sh
   curl -s -H 'Content-Type: application/graphql' \
     -d '{ getAccount(accountName: "guest") { accountNum authService } }' \
     https://accounts.NETWORK/graphql
   ```

2. Upgrade `AuthSigService` to a version that has `initKeys`. Installing the package runs the two actions above, so this alone creates the account:

   ```sh
   psibase -a https://NETWORK install --sign block.key AuthSigService
   ```

   If the service was upgraded some other way, send the same two actions yourself, from the source tree of the version that is installed:

   ```sh
   psibase -a https://NETWORK push --sign block.key packages/system/AuthSig/postinstall.json
   ```

   Either may be repeated.

3. Check the result with the query under [The key](#the-key): the key as owner and active, and no recovery partner. Then check that the account is refused:

   ```sh
   echo '[{"sender":"guest","service":"accounts","method":"setAuthServ","data":{"authService":"auth-sig"}}]' \
     | psibase -a https://NETWORK push
   ```

   must fail with an authorization error.
