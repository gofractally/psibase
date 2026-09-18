# Issue #1688 — Authenticated query call sites

Inventory of GraphQL/REST query handlers across services. Use the Verdict column
for who should be allowed; compare against `Existing` where filled. Target pattern:
`serveSys(..., user)` + check requested account against authenticated user.

Reference implementations: Tokens, NameMarket, VirtualServer.


TODO:
[ ] event queries?
[ ] sequencing: do this branch work and base on a fix-the-issues-that-showed-up-branch
[ ] we're likely to break shit; that's expected.
[ ] missing queries? definitely missing Tokens queries
[ ] need a helper fn for [user, delegations]
[ ] always assert sender to `serverSys` is `httpServer`


## Query inventory

Sorted by Service, then by declaration order in that service’s query source.
`Existing` = current auth constraint when known, or `none`; blank if not filled in.

| Service | fn/query name | Existing | Verdict |
| --- | --- | --- | --- |
| Accounts | `getAccount` | | protected |
| Accounts | `getAccounts` | | protected |
| AuthDelegate | `owned` | | owner |
| AuthDelegate | `owner` | | protected |
| AuthDyn | `get_management` | | account, manager |
| AuthDyn | `get_managed` | | account, manager |
| AuthSig | `accWithKey` | | public |
| AuthSig | `account` | | public |
| Branding | `network_name` | none | public |
| Chainmail | `get_saved_msgs` | | owner of msg |
| Chainmail | `GET /api/messages` | | owner of msg |
| CommonApi | `GET /common/thisservice` | none | |
| CommonApi | `GET /common/rootdomain` | none | |
| CommonApi | `GET /common/tapos/head` | none | |
| CommonApi | `GET /common/chainid` | none | |
| DiffAdjust | `rateLimit` | none | |
| DynLd | `depsFor` | | |
| Evaluations | `get_groups_created` | | protected |
| Evaluations | `get_group_key` | | ? |
| Evaluations | `get_group_result` | | protected |
| Evaluations | `get_group` | | protected |
| Evaluations | `get_evaluation` | | protected |
| Evaluations | `get_last_evaluation` | | protected |
| Evaluations | `get_groups` | | protected |
| Evaluations | `get_group_users` | | user in that group |
| Evaluations | `get_users` | | user in that group |
| Evaluations | `get_user_settings` | | protected? |
| Events | `POST /sql` | `isAdmin(user, …)` — admin JWT/session, not requested-account match | |
| Explorer | `blocks` | none | |
| Fractals | `fractal` | | |
| Fractals | `fractals` | none | |
| Fractals | `fractals_list` | | |
| Fractals | `member` | | protected? |
| Fractals | `memberships` | | protected? |
| Fractals | `members` | | protected? |
| Guilds | `get_groups_created` | none | |
| Guilds | `group_finishes` | none | |
| Guilds | `evaluation_finishes` | | |
| Guilds | `scheduled_evaluations` | | |
| Guilds | `ranked_guilds` | | |
| Guilds | `role_map` | | |
| Guilds | `guild_membership` | | |
| Guilds | `guild_invite` | none | |
| Guilds | `guilds_by_fractal` | | |
| Guilds | `guild_application` | | ? |
| Guilds | `guild_applications` | | ? |
| Guilds | `guild` | | |
| Guilds | `memberships` | | |
| Guilds | `scores` | | |
| Identity | `all_attestations` | none | protected |
| Identity | `attestations_by_attester` | | protected |
| Identity | `attestations_by_subject` | | protected |
| Identity | `all_attestation_stats` | none | |
| Identity | `subject_stats` | | protected |
| Invite | `inviteById` | | public |
| Invite | `invitesByInviter` | | inviter |
| Invite | `getInviteCost` | none | |
| Invite | `history` | | protected? |
| NameMarket | `current_prices` | none | |
| NameMarket | `market_params` | none | |
| NameMarket | `unclaimed_names` | `require_authenticated()` — any logged-in session; result scoped to `self.user` | |
| NameMarket | `name_events` | `check_user_auth(owner)` — authenticated user equals `owner`, or `is_auth(owner, serve_sys(), …)` | |
| Nft | `allNfts` | | delete this |
| Nft | `userConf` | | user, delegations |
| Nft | `issuerNfts` | | issuer, delegations |
| Nft | `userNfts` | | user, delegations |
| Nft | `nftDetails` | | issuer, owner, their delegations |
| Nft | `userCredits` | | user, delegations |
| Nft | `userDebits` | | user, delegations |
| Packages | `installed` | none | |
| Packages | `newAccounts` | | |
| Packages | `package` | | protected? |
| Packages | `packages` | | protected? |
| Packages | `sources` | | protected? |
| Packages | `GET /manifest` | none | |
| Packages | `GET /schema` | none | |
| Producers | `candidatesInfo` | | protected? |
| Producers | `allCandidates` | none | |
| Producers | `producers` | none | |
| Producers | `nextProducers` | none | |
| Producers | `consensus` | none | |
| Producers | `nextConsensus` | none | |
| Producers | `jointStart` | none | |
| Profiles | `profile` | | protected? |
| Registry | `app_metadata` | | public? |
| Registry | `related_tags` | none | |
| Registry | `get_all_tags` | none | |
| Registry | `status_history` | | public |
| SetCode | `code` | | |
| Sites | `getDefaultCsp` | none | |
| Sites | `getConfig` | | public |
| Sites | `getContent` | | public |
| Sites | `getContentAt` | | public |
| StagedTx | `details` | | actor, delegations, and the parties themselves |
| StagedTx | `responses` | | delegations, and the parties themselves |
| StagedTx | `get_staged` | | actor, parties, delegations |
| StagedTx | `get_staged_by_proposer` | | proposer |
| StagedTx | `get_ids_for_party` | | delegations (named_approvers), parties themselves, and other, e.g., producers (via app's Auth service, getDelegations?), must take into account Auth services |
| StagedTx | `actor_history` | | actor |
| StagedTx | `txid_history` | | delegations, parties |
| Symbol | `symbol_length` | none | |
| Symbol | `symbol` | none | |
| Symbol | `mapping` | none | |
| Symbol | `symbol_events` | | protected? |
| TokenStream | `stream` | none | |
| TokenStream | `streams` | none | |
| TokenStream | `created` | none | |
| TokenStream | `updates` | none | |
| TokenSwap | `all_pools` | none | |
| TokenSwap | `reserves_by_token` | none | |
| TokenSwap | `pool` | none | |
| Tokens | `config` | | public |
| Tokens | `token` | | public |
| Tokens | `user_settings` | | user, delegations |
| Tokens | `user_pending` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `user_balances` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `user_balance` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `user_tokens` | | user, delegations |
| Tokens | `user_subaccounts` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `subaccount_balance` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `subaccount_balances` | `check_user_auth(user)` — authenticated user must equal requested `user` (exact match only) | user, delegations |
| Tokens | `configurations` | | public |
| Tokens | `supplyChanges` | | public |
| Tokens | `balChanges` | `check_user_auth(account)` — authenticated user must equal requested `account` (exact match only) | user, delegations |
| Transact | `snapshotInfo` | none | |
| Transact | `GET /jwt_key` | `isAdmin(user, …)` — admin only | |
| Transact | `GET /stats` | `isAdmin(user, …)` — admin only | |
| VirtualServer | `get_billing_config` | none | |
| VirtualServer | `get_server_specs` | none | |
| VirtualServer | `get_network_variables` | none | |
| VirtualServer | `get_network_specs` | none | |
| VirtualServer | `network_pricing` | none | |
| VirtualServer | `cpu_pricing` | none | |
| VirtualServer | `disk_pricing` | none | |
| VirtualServer | `db_prealloc` | none | |
| VirtualServer | `disk_cost` | none | |
| VirtualServer | `disk_refund` | none | |
| VirtualServer | `user_resources` | `check_user_auth(account)` — authenticated user equals `account`, or `is_auth(account, serve_sys(), …)` | |
| VirtualServer | `consumed_history` | `check_user_auth(account)` — authenticated user equals `account`, or `is_auth(account, serve_sys(), …)` | |
| VirtualServer | `subsidy_history` | `check_user_auth` on purchaser or recipient alone; `check_users_auth` if both (exact match or `is_auth` for either) | |
| VirtualServer | `block_usage_history` | none | |
| XAdmin | `GET /config` | `checkAuth` / `isAdmin` | |
| XAdmin | `GET /services/{account}` | `checkAuth` / `isAdmin` | |
| XAdmin | `GET /packages/*` | none | |
| XAdmin | `GET /admin_accounts` | `checkAuth` / `isAdmin` | |
| XAdmin | `GET /admin_login` | `checkAuth` / `isAdmin` | |
| XPackages | `installed` | `checkAuth` / `isAdmin` (gates whole `serveSys`) | |
| XPeers | `peers` | `checkAuth` / `isAdmin` | |
| XPeers | `urls` | `checkAuth` / `isAdmin` | |
| XPeers | `users` | `checkAuth` / `isAdmin` | |
| XPeers | `GET /peers` | `checkAuth` / `isAdmin` | |
| XPeers | `GET /urls` | `checkAuth` / `isAdmin` | |
| XProxy | `originServers` | `checkAuth` / `isAdmin` | |
