//! r-mcp (account `mcp+1`, a subaccount so it can read `mcp` tables): query service for `mcp`. `needsApproval(owner)` is gated by the
//! query token: http-server passes the token's `user` into `serveSys`, and the
//! query only answers when that user is the owner account.

#[psibase::service(name = "mcp+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use mcp::tables::{
        AgentCfg, AgentTable, AllowTable, Allowed, Pending, PendingTable, RuleTable,
    };
    use psibase::*;

    fn check(cond: bool, msg: &str) {
        if !cond {
            abort_message(msg)
        }
    }

    struct Query {
        user: Option<AccountNumber>,
    }

    /// Owner check, factored for unit testing.
    pub fn owner_only(
        user: Option<AccountNumber>,
        owner: AccountNumber,
    ) -> async_graphql::Result<()> {
        match user {
            None => Err(async_graphql::Error::new(
                "permission denied: a query token for the owning account is required",
            )),
            Some(u) if u != owner => Err(async_graphql::Error::new(format!(
                "permission denied: only '{}' can view this list",
                owner
            ))),
            Some(_) => Ok(()),
        }
    }

    #[derive(SimpleObject)]
    struct NeedsApproval {
        pending: Pending,
        /// service:method pairs Approve and Grant would add
        missing: Vec<String>,
        /// JSON with decoded parameters, standing limits, and failures per action.
        inspection: String,
        can_enforce: bool,
    }

    #[Object]
    impl Query {
        /// Staged txs (sender = `owner`) that lack agent permissions. Only
        /// viewable with `owner`'s query token.
        ///
        /// `owner` defaults to the query token's own account.
        async fn needsApproval(
            &self,
            owner: Option<AccountNumber>,
            ids: Option<Vec<u32>>,
        ) -> async_graphql::Result<Vec<NeedsApproval>> {
            let owner = owner.or(self.user).ok_or_else(|| {
                async_graphql::Error::new(
                    "permission denied: a query token for the owning account is required",
                )
            })?;
            owner_only(self.user, owner)?;
            let mut out = Vec::new();
            let ids = ids.unwrap_or_else(|| {
                PendingTable::with_service(mcp::SERVICE)
                    .get_index_pk()
                    .range((owner, 0)..=(owner, u32::MAX))
                    .map(|p| p.id)
                    .collect()
            });
            for id in ids {
                let tx = services::staged_tx::Wrapper::call().get_staged_tx(id);
                if !tx.action_list.actions.iter().any(|a| a.sender == owner) {
                    continue;
                }
                let p = Pending {
                    account: owner,
                    id,
                    txid: tx.txid,
                    proposer: tx.proposer,
                    actions: tx.action_list.actions,
                };
                let mut can_enforce = tx.auto_exec
                    && !p.actions.is_empty()
                    && AgentTable::with_service(mcp::SERVICE)
                        .get_index_pk()
                        .get(&owner)
                        .and_then(|c| c.enforcer)
                        .is_some();
                let inspection: Vec<_> = p.actions.iter().map(|a| {
                    let limits = RuleTable::with_service(mcp::SERVICE).get_index_pk()
                        .get(&(owner, a.service, a.method)).map(|r| r.limits).unwrap_or_default();
                    let checked = mcp::limits::inspect(a, &limits);
                    can_enforce &= a.sender == owner && checked.failures.is_empty()
                        && !mcp::policy::is_banned(a.service, a.method)
                        && AllowTable::with_service(mcp::SERVICE).get_index_pk().get(&(owner, a.service, a.method)).is_some();
                    serde_json::json!({ "service": a.service, "method": a.method,
                        "parameters": checked.parameters, "limits": limits, "failures": checked.failures })
                }).collect();
                let pairs: Vec<_> = p.actions.iter().map(|a| (a.service, a.method)).collect();
                let missing = mcp::policy::missing_pairs(&pairs, |s, m| {
                    AllowTable::with_service(mcp::SERVICE)
                        .get_index_pk()
                        .get(&(owner, s, m))
                        .is_some()
                })
                .into_iter()
                .map(|(s, m)| format!("{s}:{m}"))
                .collect();
                out.push(NeedsApproval {
                    pending: p,
                    missing,
                    inspection: serde_json::to_string(&inspection).unwrap(),
                    can_enforce,
                });
            }
            Ok(out)
        }

        /// Agent config for an owner account (public: who is the agent).
        async fn agent(&self, account: AccountNumber) -> Option<AgentCfg> {
            AgentTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .get(&account)
        }

        /// `owner`'s agent config, as a 0- or 1-element list (defaults to the
        /// query-token user).
        async fn myAgents(
            &self,
            owner: Option<AccountNumber>,
        ) -> async_graphql::Result<Vec<AgentCfg>> {
            let owner = owner.or(self.user).ok_or_else(|| {
                async_graphql::Error::new(
                    "permission denied: a query token for the owning account is required",
                )
            })?;
            owner_only(self.user, owner)?;
            Ok(AgentTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .get(&owner)
                .into_iter()
                .collect())
        }

        /// The allowlist for an account (owner-only, like needsApproval).
        async fn allowlist(&self, account: AccountNumber) -> async_graphql::Result<Vec<Allowed>> {
            AgentTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .get(&account)
                .ok_or_else(|| async_graphql::Error::new("no agent"))?;
            owner_only(self.user, account)?;
            Ok(AllowTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .range(
                    (account, AccountNumber::new(0), MethodNumber::new(0))
                        ..=(
                            account,
                            AccountNumber::new(u64::MAX),
                            MethodNumber::new(u64::MAX),
                        ),
                )
                .collect())
        }
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        check(
            get_sender() == services::http_server::SERVICE,
            "permission denied: serveSys only callable by 'http-server'",
        );
        None.or_else(|| serve_graphql(&request, Query { user }))
            .or_else(|| serve_graphiql(&request))
    }
}

#[cfg(test)]
mod tests {
    // owner_only is private to the generated module; behaviour is covered by
    // Playwright spec packages/user/Mcp/e2e/query-gating.spec.ts.
}
