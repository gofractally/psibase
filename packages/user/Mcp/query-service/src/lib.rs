//! r-mcp (account `mcp+1`, a subaccount so it can read `mcp` tables): query service for `mcp`. `needsApproval(owner)` is gated by the
//! query token: http-server passes the token's `user` into `serveSys`, and the
//! query only answers when that user is the owner (the parent account).

#[psibase::service(name = "mcp+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use mcp::tables::{AgentCfg, AgentTable, AllowTable, Allowed, Pending, PendingTable};
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
    pub fn owner_only(user: Option<AccountNumber>, owner: AccountNumber) -> async_graphql::Result<()> {
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
    }

    #[Object]
    impl Query {
        /// Staged txs that lack agent permissions, for every account `owner`
        /// is the parent of. Only viewable with `owner`'s query token.
        ///
        /// `owner` defaults to the query token's own account.
        async fn needsApproval(&self, owner: Option<AccountNumber>) -> async_graphql::Result<Vec<NeedsApproval>> {
            let owner = owner.or(self.user).ok_or_else(|| {
                async_graphql::Error::new("permission denied: a query token for the owning account is required")
            })?;
            owner_only(self.user, owner)?;
            let mut out = Vec::new();
            for cfg in AgentTable::with_service(mcp::SERVICE)
                .get_index_by_parent()
                .range((owner, AccountNumber::new(0))..=(owner, AccountNumber::new(u64::MAX)))
            {
                for p in PendingTable::with_service(mcp::SERVICE)
                    .get_index_pk()
                    .range((cfg.account, 0)..=(cfg.account, u32::MAX))
                {
                    let pairs: Vec<_> = p.actions.iter().map(|a| (a.service, a.method)).collect();
                    let missing = mcp::policy::missing_pairs(&pairs, |s, m| {
                        AllowTable::with_service(mcp::SERVICE)
                            .get_index_pk()
                            .get(&(cfg.account, s, m))
                            .is_some()
                    })
                    .into_iter()
                    .map(|(s, m)| format!("{s}:{m}"))
                    .collect();
                    out.push(NeedsApproval { pending: p, missing });
                }
            }
            Ok(out)
        }

        /// Agent config for an account (public: who is agent and parent).
        async fn agent(&self, account: AccountNumber) -> Option<AgentCfg> {
            AgentTable::with_service(mcp::SERVICE).get_index_pk().get(&account)
        }

        /// Configs where `owner` is the parent (defaults to the query-token user).
        async fn myAgents(&self, owner: Option<AccountNumber>) -> async_graphql::Result<Vec<AgentCfg>> {
            let owner = owner.or(self.user).ok_or_else(|| {
                async_graphql::Error::new(
                    "permission denied: a query token for the owning account is required",
                )
            })?;
            owner_only(self.user, owner)?;
            Ok(AgentTable::with_service(mcp::SERVICE)
                .get_index_by_parent()
                .range((owner, AccountNumber::new(0))..=(owner, AccountNumber::new(u64::MAX)))
                .collect())
        }

        /// The allowlist for an account (owner-only, like needsApproval).
        async fn allowlist(&self, account: AccountNumber) -> async_graphql::Result<Vec<Allowed>> {
            let cfg = AgentTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .get(&account)
                .ok_or_else(|| async_graphql::Error::new("no agent"))?;
            owner_only(self.user, cfg.parent)?;
            Ok(AllowTable::with_service(mcp::SERVICE)
                .get_index_pk()
                .range((account, AccountNumber::new(0), MethodNumber::new(0))..=(account, AccountNumber::new(u64::MAX), MethodNumber::new(u64::MAX)))
                .collect())
        }
    }

    #[action]
    fn serveSys(request: HttpRequest, _socket: Option<i32>, user: Option<AccountNumber>) -> Option<HttpReply> {
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
