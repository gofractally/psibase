#![allow(non_snake_case)]

mod stats;
#[cfg(test)]
mod tests;

#[psibase::service_tables]
mod tables {
    use async_graphql::*;
    use core::fmt;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "AttestationTable", index = 1)]
    #[derive(Debug, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct Attestation {
        /// The attesting account / the issuer
        pub attester: AccountNumber,

        /// creation/issue time
        pub issued: psibase::TimePointSec,

        /// The credential subject, in this case, the subject/attestee
        pub subject: AccountNumber,

        pub value: u8,
    }

    impl Attestation {
        #[primary_key]
        fn by_subject(&self) -> (AccountNumber, AccountNumber) {
            (self.subject, self.attester)
        }

        #[secondary_key(1)]
        fn by_attester(&self) -> (AccountNumber, AccountNumber) {
            (self.attester, self.subject)
        }
    }

    impl fmt::Display for Attestation {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            writeln!(
                f,
                "--Attestation--\n  {}: attester\n  {}: subject\n  {}: value\n  {}: issued",
                self.attester, self.subject, self.value, self.issued.seconds
            )
        }
    }

    #[table(name = "AttestationStatsTable", index = 2)]
    #[derive(Debug, Fracpack, ToSchema, Serialize, Deserialize, SimpleObject)]
    pub struct AttestationStats {
        /// The credential subject, in this case, the subject/subject
        #[primary_key]
        pub subject: AccountNumber,

        // % high conf + # unique attestations will give an approximation of a Google Review for a user
        pub numHighConfAttestations: u16,

        pub uniqueAttesters: u16,

        // freshness indicator
        pub mostRecentAttestation: TimePointSec,
    }

    impl fmt::Display for AttestationStats {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            writeln!(
                f,
                "--AttestationStats--\n{}\t: subject\n{} :# unique attesters\n{}\t: % high conf\n{} :most recent attestation",
                self.subject,
                self.uniqueAttesters,
                self.numHighConfAttestations,
                self.mostRecentAttestation.seconds
            )
        }
    }
}

/// Identity service to log identity attestations, and provide a graphiql
/// query interface.
#[psibase::service(name = "identity", tables = "tables")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::services::{accounts::Wrapper as AccountsSvc, transact};
    use psibase::*;

    use crate::stats::update_attestation_stats;
    use crate::tables::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
        services::http_server::Wrapper::call().registerServer(SERVICE);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not initialized",
        );
    }

    #[action]
    pub fn attest(subject: AccountNumber, value: u8) {
        check(value <= 100, "bad confidence score");
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time.seconds();

        let attestation_table = AttestationTable::new();

        // verify subject is valid chain account
        psibase::check(
            AccountsSvc::call().exists(subject),
            &format!("subject account {} doesn't exist", subject),
        );

        let existing_rec = attestation_table.get_index_pk().get(&(subject, attester));

        // upsert attestation
        attestation_table
            .put(&Attestation {
                attester,
                issued,
                subject,
                value,
            })
            .unwrap();

        // Update Attestation stats
        update_attestation_stats(existing_rec, subject, value, issued);

        Wrapper::emit()
            .history()
            .attest_identity_claim(attester, issued, subject, value);
    }

    #[event(history)]
    pub fn attest_identity_claim(
        id: AccountNumber,
        issued: TimePointSec,
        subject: AccountNumber,
        value: u8,
    ) {
    }

    use async_graphql::connection::Connection;
    struct Query;

    #[Object]
    impl Query {
        async fn all_attestations(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Attestation>, async_graphql::Error> {
            TableQuery::new(AttestationTable::new().get_index_pk())
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
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

        async fn attestations_by_subject(
            &self,
            subject: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
            TableQuery::subindex::<AccountNumber>(AttestationTable::new().get_index_pk(), &subject)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        async fn all_attestation_stats(
            &self,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, AttestationStats>, async_graphql::Error>
        {
            TableQuery::new(AttestationStatsTable::new().get_index_pk())
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        async fn subject_stats(
            &self,
            subject: AccountNumber,
        ) -> async_graphql::Result<Option<AttestationStats>, async_graphql::Error> {
            Ok(AttestationStatsTable::new().get_index_pk().get(&subject))
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }
}
