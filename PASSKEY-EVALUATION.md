1. The node is a point of failure and a trust point, given it serves the front end that does the local security work for the chain account.

2. The delay doesn't cover other functions that can affect the security of the account. Specifically: swapping the auth service, swapping the verifier, or shrinking the 24-hour pause and 7-day freeze.

3. The normal flow should require that the only modification of keys originates with a rotating of the passkey. An opt-out power-user option should exist for bringing in external active or owner keys, since the current design accepts imported owner keys as the user's responsibility with no chain-side check that the owner key ties to a passkey.

4. An attacker with an owner key can use delays and freezes as a means of spamming the account. An open question about whether clocks stop during a pause means repeated pauses could stretch an old key's freeze window indefinitely.

5. OAuth ties to a passkey which can tie to multiple accounts.

6. A compromised passkey (its secret, or a stolen unlocked passkey) yields the root, and with it every key of every account under it. The chain never sees the passkey, so it cannot be revoked: rotating sequence values does not help because they are public, and each account must be moved to a new passkey through its recovery partner. The attacker can also decrypt and overwrite the account list, exposing every account the user holds.
