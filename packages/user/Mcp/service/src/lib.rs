//! `mcp`: objective service that is the parent (managing human account)'s
//! frontend for X-MCP agents. It is:
//!
//! - an AuthDyn manager (`get_policy` / `has_policy`) whose policy is a
//!   per-account service+method allowlist: allowlisted -> the agent signs
//!   alone (covered tx auto-executes); otherwise -> the parent must approve;
//!   auth/code changes -> impossible.
//! - the record of staged transactions that need parent approval (`track`),
//!   served by the query-token-gated `needsApproval` query in `r-mcp`.
//! - the "Approve and Grant" admin action (`grant_missing`), which the UI
//!   bundles with `staged-tx::accept` in one transaction.

pub mod policy;

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{AccountNumber, Action, MethodNumber, Pack, Table, ToSchema, Unpack, Checksum256};
    use serde::{Deserialize, Serialize};

    /// A managed account, its agent, and its parent (approver).
    #[table(name = "AgentTable", index = 0)]
    #[derive(Pack, Unpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug, Clone)]
    pub struct AgentCfg {
        #[primary_key]
        pub account: AccountNumber,
        pub agent: AccountNumber,
        pub parent: AccountNumber,
    }

    impl AgentCfg {
        #[secondary_key(1)]
        fn by_parent(&self) -> (AccountNumber, AccountNumber) {
            (self.parent, self.account)
        }
        pub fn get(account: AccountNumber) -> Option<Self> {
            AgentTable::read().get_index_pk().get(&account)
        }
    }

    /// One allowlisted service+method for a managed account.
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
        pub fn is_allowed(account: AccountNumber, service: AccountNumber, method: MethodNumber) -> bool {
            AllowTable::read()
                .get_index_pk()
                .get(&(account, service, method))
                .is_some()
        }
    }

    /// A staged transaction proposed by an agent that needs parent approval.
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

#[psibase::service(name = "mcp", tables = "tables")]
pub mod service {
    use crate::policy::{self, Decision};
    use crate::tables::*;
    use psibase::services::auth_dyn::policy::DynamicAuthPolicy;
    use psibase::services::accounts::Wrapper as Accounts;
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

    fn require_parent(account: AccountNumber) -> AgentCfg {
        let cfg = AgentCfg::get(account).expect("account has no X-MCP agent");
        check(get_sender() == cfg.parent, "only the parent account may do this");
        cfg
    }

    /// Called by the managed account (before `auth-dyn::set_mgmt(account, mcp)`)
    /// to register its agent and parent. Afterwards only the parent, via a
    /// StagedTx that this manager routes to it, can change it.
    #[action]
    fn set_agent(agent: AccountNumber, parent: AccountNumber) {
        let account = get_sender();
        if let Some(cfg) = AgentCfg::get(account) {
            check(false, &format!("agent already set; parent {} must change it", cfg.parent));
        }
        check(agent != account && parent != account, "agent and parent must differ from account");
        check(Accounts::call().exists(agent), "agent account does not exist");
        check(Accounts::call().exists(parent), "parent account does not exist");
        // Ordering rule (set_agent before management handover): this must run
        // while `account` still signs for itself. `has_policy` is false until
        // it has, so `auth-dyn::set_mgmt(account, mcp)` aborts if attempted
        // first; once managed, `set_agent` is `impossible()` under this
        // manager's own policy, so it cannot be re-run through StagedTx.
        check(
            Accounts::call()
                .getAccount(account)
                .map_or(true, |a| a.authService != psibase::services::auth_dyn::SERVICE),
            "set_agent must be called before handing management to mcp",
        );
        AgentTable::read_write()
            .put(&AgentCfg { account, agent, parent })
            .unwrap();
    }

    /// Parent adds one service+method to the agent's allowlist.
    #[action]
    fn grant(account: AccountNumber, service: AccountNumber, method: MethodNumber) {
        require_parent(account);
        check(!policy::is_banned(service, method), "method cannot be granted to an agent");
        AllowTable::read_write()
            .put(&Allowed { account, service, method })
            .unwrap();
    }

    /// Parent removes one service+method from the agent's allowlist.
    #[action]
    fn revoke(account: AccountNumber, service: AccountNumber, method: MethodNumber) {
        require_parent(account);
        AllowTable::read_write().remove(&Allowed { account, service, method });
    }

    /// "Approve and Grant": the parent grants every ungranted (non-banned)
    /// service+method in staged tx `id`. The UI sends this together with
    /// `staged-tx::accept(id, txid)` in one transaction.
    #[action]
    fn grant_missing(account: AccountNumber, id: u32) {
        require_parent(account);
        let row = PendingTable::read()
            .get_index_pk()
            .get(&(account, id))
            .expect("unknown pending transaction");
        let pairs: Vec<_> = row.actions.iter().map(|a| (a.service, a.method)).collect();
        let table = AllowTable::read_write();
        for (service, method) in policy::missing_pairs(&pairs, allowed_fn(account)) {
            table.put(&Allowed { account, service, method }).unwrap();
        }
        PendingTable::read_write().remove(&row);
    }

    /// Records staged tx `id` as needing parent approval. Anyone may call it
    /// (normally the agent, right after `propose`); it only records txs that
    /// act as a managed account and are not fully covered by the allowlist.
    #[action]
    fn track(id: u32) {
        let tx = StagedTx::call().get_staged_tx(id);
        let account = tx
            .action_list
            .actions
            .iter()
            .map(|a| a.sender)
            .find(|s| AgentCfg::get(*s).is_some())
            .expect("staged tx does not act as an X-MCP managed account");
        let pairs: Vec<_> = tx
            .action_list
            .actions
            .iter()
            .filter(|a| a.sender == account)
            .map(|a| (a.service, a.method))
            .collect();
        check(!policy::covered(&pairs, allowed_fn(account)), "covered by the allowlist; no approval needed");
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

    /// Parent (after Approve) or proposer removes a tracked row.
    #[action]
    fn untrack(account: AccountNumber, id: u32) {
        let row = PendingTable::read()
            .get_index_pk()
            .get(&(account, id))
            .expect("unknown pending transaction");
        let cfg = AgentCfg::get(account).unwrap();
        let s = get_sender();
        check(s == cfg.parent || s == row.proposer, "only parent or proposer");
        PendingTable::read_write().remove(&row);
    }

    /// AuthDyn manager interface.
    #[action]
    fn get_policy(account: AccountNumber, method: Option<ServiceMethod>) -> DynamicAuthPolicy {
        let cfg = AgentCfg::get(account).expect("account has no X-MCP agent");
        match policy::decide(method.map(|m| (m.service, m.method)), allowed_fn(account)) {
            Decision::Agent => DynamicAuthPolicy::from_sole_authorizer(cfg.agent),
            Decision::Parent => DynamicAuthPolicy::from_sole_authorizer(cfg.parent),
            Decision::Impossible => DynamicAuthPolicy::impossible(),
        }
    }

    /// AuthDyn manager interface.
    #[action]
    fn has_policy(account: AccountNumber) -> bool {
        AgentCfg::get(account).is_some()
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests;
