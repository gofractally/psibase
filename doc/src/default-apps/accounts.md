# accounts

{{#cpp-doc ::SystemService::Accounts}}
{{#cpp-doc ::SystemService::AccountsStatus}}
{{#cpp-doc ::SystemService::Account}}

## The guest account

Every chain that has [auth-sig](auth-sig.md#the-guest-account) has an account named `guest` that nobody can authorize. This service does not treat the name specially: `guest` is in the account table like any other account, and cannot be created again because it exists.
