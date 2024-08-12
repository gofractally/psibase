#[cfg(test)]
mod tests;

// mod queries;
mod stats;

/// Identity service to log identity attestations, and provide a graphiql
/// query interface.
#[psibase::service(name = "identity")]
#[allow(non_snake_case)]
mod service {
    use core::fmt;

    use async_graphql::*;

    use psibase::{
        services::{accounts::Wrapper as AccountsSvc, transact},
        AccountNumber, TableQuery, TimePointSec, *,
    };
    use serde::{Deserialize, Serialize};

    use crate::stats::update_attestation_stats;
    use std::cmp::Ordering;

    impl PartialEq for Attestation {
        fn eq(&self, other: &Self) -> bool {
            self.cmp(&other) == Ordering::Equal
        }
    }
    impl PartialOrd for Attestation {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(&other))
        }
    }

    impl Ord for Attestation {
        fn cmp(&self, other: &Self) -> Ordering {
            match self.attester.to_string().cmp(&other.attester.to_string()) {
                Ordering::Equal => {
                    return match self.subject.to_string().cmp(&other.subject.to_string()) {
                        Ordering::Equal => {
                            return match self.value.cmp(&other.value) {
                                Ordering::Equal => {
                                    return self.issued.seconds.cmp(&other.issued.seconds)
                                }
                                ord => ord,
                            }
                        }
                        ord => ord,
                    }
                }
                ord => ord,
            }
        }
    }

    #[table(name = "AttestationTable", index = 0)]
    #[derive(
        Fracpack, ToSchema, Serialize, Deserialize, SimpleObject, Debug, Clone, Default, Eq,
    )]
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
        fn by_attestee(&self) -> (AccountNumber, AccountNumber) {
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

    impl PartialEq for AttestationStats {
        fn eq(&self, other: &Self) -> bool {
            self.subject == other.subject
                && self.numHighConfAttestations == other.numHighConfAttestations
                && self.uniqueAttesters == other.uniqueAttesters
        }
    }

    #[table(name = "AttestationStatsTable", index = 1)]
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, SimpleObject, Debug, Clone, Eq)]
    pub struct AttestationStats {
        /// The credential subject, in this case, the subject/attestee
        #[primary_key]
        pub subject: AccountNumber,

        // % high conf + # unique attestations will give an approximation of a Google Review for a user
        // pub perc_high_conf: u8,
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

    impl Default for AttestationStats {
        fn default() -> Self {
            AttestationStats {
                subject: AccountNumber::from(0),
                numHighConfAttestations: 0,
                uniqueAttesters: 0,
                mostRecentAttestation: TimePointSec::from(0),
            }
        }
    }

    #[table(record = "WebContentRow", index = 2)]
    struct WebContentTable;

    #[action]
    pub fn attest(subject: AccountNumber, value: u8) {
        check(value <= 100, "bad confidence score");
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;

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
            // .iter()
            // .collect::<Vec<Attestation>>())
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

        async fn event(&self, id: u64) -> Result<event_structs::HistoryEvents, anyhow::Error> {
            get_event(id)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
    }

    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(get_sender() == get_service(), "unauthorized");
        let table = WebContentTable::new();
        store_content(path, contentType, content, &table).unwrap();
    }
}
