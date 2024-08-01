use crate::service::AttestationTable;
use crate::service::*;
use async_graphql::connection::Connection;
use async_graphql::*;
use psibase::*;

#[Object]
impl Query {
    async fn all_attestations(
        &self,
    ) -> async_graphql::Result<Vec<Attestation>, async_graphql::Error> {
        Ok(AttestationTable::new()
            .get_index_pk()
            .iter()
            .collect::<Vec<Attestation>>())
    }

    async fn attestations_by_attester(
        &self,
        attester: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
        TableQuery::subindex::<AccountNumber>(
            AttestationTable::new().get_index_by_attester(),
            &attester,
        )
        .first(first)
        .last(last)
        .before(before)
        .after(after)
        .query()
        .await
    }

    async fn attestations_by_attestee(
        &self,
        attestee: AccountNumber,
        first: Option<i32>,
        last: Option<i32>,
        before: Option<String>,
        after: Option<String>,
    ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
        TableQuery::subindex::<AccountNumber>(AttestationTable::new().get_index_pk(), &attestee)
            .first(first)
            .last(last)
            .before(before)
            .after(after)
            .query()
            .await
    }

    async fn all_attestation_stats(
        &self,
    ) -> async_graphql::Result<Vec<AttestationStats>, async_graphql::Error> {
        Ok(AttestationStatsTable::new()
            .get_index_pk()
            .iter()
            .collect::<Vec<AttestationStats>>())
    }

    async fn event(&self, id: u64) -> Result<event_structs::HistoryEvents, anyhow::Error> {
        get_event(id)
    }
}
