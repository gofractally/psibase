//! `mcp`: objective service that is the owner's frontend for X-MCP agents,
//! and the owner's auth service (two-account model, no managed sibling).
//!
//! - Auth service for the owner's own account. `checkAuthSys` verifies the
//!   owner's AuthSig key (the key stays registered in `auth-sig`, so normal key
//!   login keeps working). On the staged path (`isAuthSys` / `getDlgsSys`) the
//!   per-account service+method allowlist decides: allowlisted -> the agent's
//!   accept (its implicit accept on `propose`) is enough and a covered tx
//!   auto-executes; otherwise the owner must accept; auth/code changes ->
//!   impossible.
//! - the record of staged transactions that need owner approval (`track`),
//!   served by the query-token-gated `needsApproval` query in `r-mcp`.
//! - the "Approve and Grant" admin action (`grant_missing`), which the UI
//!   bundles with `staged-tx::accept` in one transaction.

pub mod policy;

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{
        AccountNumber, Action, Checksum256, MethodNumber, Pack, Table, ToSchema, Unpack,
    };
    use serde::{Deserialize, Serialize};

    /// An owner account and its agent. The owner is the sender on the agent's
    /// staged transactions; there is no separate managed account.
    #[table(name = "AgentTable", index = 0)]
    #[derive(Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct AgentCfg {
        /// The owner (human) account.
        #[primary_key]
        pub account: AccountNumber,
        pub agent: AccountNumber,
    }

    impl AgentCfg {
        pub fn get(account: AccountNumber) -> Option<Self> {
            AgentTable::read().get_index_pk().get(&account)
        }
    }

    /// One allowlisted service+method for an owner account.
    #[table(name = "AllowTable", index = 1)]
    #[derive(Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Allowed {
        pub account: AccountNumber,
        pub service: AccountNumber,
        pub method: MethodNumber,
    }

    impl Allowed {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, AccountNumber, MethodNumber) {
            (self.account, self.service, self.method)
        }
        pub fn is_allowed(
            account: AccountNumber,
            service: AccountNumber,
            method: MethodNumber,
        ) -> bool {
            AllowTable::read()
                .get_index_pk()
                .get(&(account, service, method))
                .is_some()
        }
    }

    /// A staged transaction proposed by an agent that needs owner approval.
    #[table(name = "PendingTable", index = 2)]
    #[derive(Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct Pending {
        pub account: AccountNumber,
        pub id: u32,
        pub txid: Checksum256,
        pub proposer: AccountNumber,
        pub actions: Vec<Action>,
    }

    impl Pending {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, u32) {
            (self.account, self.id)
        }
    }
}

#[psibase::service(name = "mcp", tables = "tables", recursive = true)]
pub mod service {
    use crate::policy::{self, Decision};
    use crate::tables::*;
    use psibase::services::accounts::Wrapper as Accounts;
    use psibase::services::auth_sig::Wrapper as AuthSig;
    use psibase::services::staged_tx::Wrapper as StagedTx;
    use psibase::services::transact::ServiceMethod;
    use psibase::*;

    fn check(cond: bool, msg: &str) {
        if !cond {
            abort_message(msg)
        }
    }

    fn allowed_fn(account: AccountNumber) -> impl Fn(AccountNumber, MethodNumber) -> bool {
        move |s, m| Allowed::is_allowed(account, s, m)
    }

    fn require_owner(account: AccountNumber) -> AgentCfg {
        let cfg = AgentCfg::get(account).expect("account has no X-MCP agent");
        check(
            get_sender() == account,
            "only the owner account may do this",
        );
        cfg
    }

    fn decision(account: AccountNumber, method: &Option<ServiceMethod>) -> Decision {
        policy::decide(
            method.as_ref().map(|m| (m.service, m.method)),
            allowed_fn(account),
        )
    }

    /// Owner registers `agent` (an existing AuthSig account) for their own
    /// account. The owner keeps their AuthSig key; the same transaction should
    /// then run `accounts::setAuthServ(mcp)` so this service authorizes the
    /// owner (which `canAuthUserSys` only allows after this action, and only
    /// while the owner has an auth-sig key, so login keeps working).
    ///
    /// Named `bootstrap` (not `bootstrap_agent`) so the method name fits
    /// MethodNumber's 13-character limit.
    #[action]
    fn bootstrap(agent: AccountNumber) {
        let owner = get_sender();
        check(agent != owner, "owner and agent must differ");
        check(
            Accounts::call().exists(agent),
            "agent account does not exist",
        );
        check(
            AgentCfg::get(owner).is_none(),
            "agent already set; use set_agent to change it",
        );
        AgentTable::read_write()
            .put(&AgentCfg {
                account: owner,
                agent,
            })
            .unwrap();
    }

    /// Owner replaces their agent (signed directly with the owner's key; it
    /// is banned on the staged path, so the agent can never change it).
    #[action]
    fn set_agent(agent: AccountNumber) {
        let owner = get_sender();
        let mut cfg = require_owner(owner);
        check(agent != owner, "owner and agent must differ");
        check(
            Accounts::call().exists(agent),
            "agent account does not exist",
        );
        cfg.agent = agent;
        AgentTable::read_write().put(&cfg).unwrap();
    }

    /// Owner adds one service+method to the agent's allowlist.
    #[action]
    fn grant(account: AccountNumber, service: AccountNumber, method: MethodNumber) {
        require_owner(account);
        check(
            !policy::is_banned(service, method),
            "method cannot be granted to an agent",
        );
        AllowTable::read_write()
            .put(&Allowed {
                account,
                service,
                method,
            })
            .unwrap();
    }

    /// Owner removes one service+method from the agent's allowlist.
    #[action]
    fn revoke(account: AccountNumber, service: AccountNumber, method: MethodNumber) {
        require_owner(account);
        AllowTable::read_write().remove(&Allowed {
            account,
            service,
            method,
        });
    }

    /// "Approve and Grant": the owner grants every ungranted (non-banned)
    /// service+method in staged tx `id`. The UI sends this together with
    /// `staged-tx::accept(id, txid)` in one transaction.
    #[action]
    fn grant_missing(account: AccountNumber, id: u32) {
        require_owner(account);
        let row = PendingTable::read()
            .get_index_pk()
            .get(&(account, id))
            .expect("unknown pending transaction");
        let pairs: Vec<_> = row.actions.iter().map(|a| (a.service, a.method)).collect();
        let table = AllowTable::read_write();
        for (service, method) in policy::missing_pairs(&pairs, allowed_fn(account)) {
            table
                .put(&Allowed {
                    account,
                    service,
                    method,
                })
                .unwrap();
        }
        PendingTable::read_write().remove(&row);
    }

    /// Records staged tx `id` as needing owner approval. Anyone may call it
    /// (normally the agent, right after `propose`); it only records txs that
    /// act as an X-MCP owner and are not fully covered by the allowlist.
    #[action]
    fn track(id: u32) {
        let tx = StagedTx::call().get_staged_tx(id);
        let account = tx
            .action_list
            .actions
            .iter()
            .map(|a| a.sender)
            .find(|s| AgentCfg::get(*s).is_some())
            .expect("staged tx does not act as an X-MCP owner");
        let pairs: Vec<_> = tx
            .action_list
            .actions
            .iter()
            .filter(|a| a.sender == account)
            .map(|a| (a.service, a.method))
            .collect();
        check(
            !policy::covered(&pairs, allowed_fn(account)),
            "covered by the allowlist; no approval needed",
        );
        PendingTable::read_write()
            .put(&Pending {
                account,
                id,
                txid: tx.txid,
                proposer: tx.proposer,
                actions: tx.action_list.actions,
            })
            .unwrap();
    }

    /// Owner (after Approve) or proposer removes a tracked row.
    #[action]
    fn untrack(account: AccountNumber, id: u32) {
        let row = PendingTable::read()
            .get_index_pk()
            .get(&(account, id))
            .expect("unknown pending transaction");
        let s = get_sender();
        check(s == account || s == row.proposer, "only owner or proposer");
        PendingTable::read_write().remove(&row);
    }

    /// Who may authorize `method` for `account` on the staged path (read-only
    /// view of the policy for UIs and tests).
    #[action]
    fn get_policy(account: AccountNumber, method: Option<ServiceMethod>) -> Vec<AccountNumber> {
        let agent = AgentCfg::get(account).map(|c| c.agent);
        policy::authorizers(account, agent, decision(account, &method))
    }

    // ---- Auth service interface (owner accounts) ----

    /// Ordinary transactions from the owner: same key check as AuthSig, against
    /// the owner's key that is still registered in `auth-sig`.
    #[action]
    #[allow(non_snake_case)]
    fn checkAuthSys(
        flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
        AuthSig::call().checkAuthSys(flags, sender, action, claims)
    }

    /// Only owners that registered an agent here and still hold an auth-sig key.
    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        check(
            AgentCfg::get(user).is_some(),
            "call mcp::bootstrap before using mcp as auth service",
        );
        AuthSig::call().canAuthUserSys(user);
    }

    /// Staged path: the accounts (other than the owner) that can authorize.
    #[action]
    #[allow(non_snake_case)]
    fn getDlgsSys(sender: AccountNumber, method: Option<ServiceMethod>) -> Vec<AccountNumber> {
        let agent = AgentCfg::get(sender).map(|c| c.agent);
        policy::authorizers(sender, agent, decision(sender, &method))
            .into_iter()
            .filter(|a| *a != sender)
            .collect()
    }

    /// Staged path: allowlisted -> agent or owner; otherwise owner; banned -> never.
    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        let agent = AgentCfg::get(sender).map(|c| c.agent);
        policy::is_approved(sender, agent, decision(sender, &method), &authorizers)
    }

    /// Staged path: the owner can always reject; banned txs are always rejectable.
    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        policy::is_rejected(sender, decision(sender, &method), &rejecters)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests;
