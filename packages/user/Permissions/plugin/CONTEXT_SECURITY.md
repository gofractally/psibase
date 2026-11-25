# Native consent context boundary

Permission prompts capture the native active application and selected user when
created. Before displaying the context or granting permission, the admin API
checks that both still match Host's authoritative values. A delegated caller is
allowed to differ from the active app; the existing allowed-caller policy is not
replaced by a caller-equals-active-app shortcut.

The internal packed context gains `active_app`; its public WIT display DTO stays
unchanged. Pending old contexts lacking that field fail closed and require a new
review. Existing session/persistent grants are not rewritten or migrated.

Host Prompt additionally permits `get-context` only to the service principal
which created the active prompt. An untrusted initiator cannot forge a packed
Permissions context and redirect its prompt UI into the Permissions origin to
grant a different callee/capability description. Supervisor's separate
admin-only routing API remains unchanged.

Authorization pages must also restrict frame ancestors to the actual Supervisor
origin; the Supervisor's interactive prompt page must remain top-level. The
hidden Supervisor RPC endpoint still permits app embedding. Context checks and
framing policy are independent defenses.

Pure regression tests cover user/app changes, logout, delegated callers, own
prompt consumers and rejection of another service's forged context. Runtime
browser tests remain necessary to verify the complete native routing flow.
