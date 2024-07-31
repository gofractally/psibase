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
    use std::str::FromStr;

    use async_graphql::*;

    use psibase::{services::transact, AccountNumber, TimePointSec, *};
    use serde::{Deserialize, Serialize};

    use crate::stats::update_attestation_stats;

    #[table(name = "AttestationTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone, Default)]
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

    #[table(name = "AttestationStatsTable", index = 1)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct AttestationStats {
        /// The credential subject, in this case, the subject/attestee
        #[primary_key]
        pub subject: AccountNumber,

        // % high conf + # unique attestations will give an approximation of a Google Review for a user
        pub perc_high_conf: u8,

        pub unique_attesters: u16,

        // freshness indicator
        pub most_recent_attestation: TimePointSec,
    }

    impl fmt::Display for AttestationStats {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            writeln!(
                f,
                "--AttestationStats--\n{}\t: subject\n{} :# unique attesters\n{}\t: % high conf\n{} :most recent attestation",
                self.subject,
                self.unique_attesters,
                self.perc_high_conf,
                self.most_recent_attestation.seconds
            )
        }
    }

    impl Default for AttestationStats {
        fn default() -> Self {
            AttestationStats {
                subject: AccountNumber::from(0),
                perc_high_conf: 0,
                unique_attesters: 0,
                most_recent_attestation: TimePointSec::from(0),
            }
        }
    }

    #[table(record = "WebContentRow", index = 2)]
    struct WebContentTable;

    #[action]
    pub fn attest(subject: String, value: u8) {
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;

        let attestation_table = AttestationTable::new();

        let subj_acct = match AccountNumber::from_str(&subject.clone()) {
            Ok(subject_acct) => subject_acct,
            Err(e) => psibase::abort_message(&format!("{}", e)),
        };

        let existing_rec = attestation_table.get_index_pk().get(&(subj_acct, attester));
        let is_unique_attester = existing_rec.is_none();

        // upsert attestation
        attestation_table
            .put(&Attestation {
                attester,
                issued,
                subject: subj_acct,
                value,
            })
            .unwrap();

        // Update Attestation stats
        // if attester-subject pair already in table, recalc %high_conf if necessary based on new score
        // if attester-subject pair not in table, increment unique attestations and calc new %high_conf score
        update_attestation_stats(subj_acct, is_unique_attester, value, issued);

        Wrapper::emit()
            .history()
            .attest_identity_claim(attester, issued, subject, value);
    }

    #[event(history)]
    pub fn attest_identity_claim(
        id: AccountNumber,
        issued: TimePointSec,
        subject: String,
        value: u8,
    ) {
    }

    use async_graphql::connection::Connection;
    struct Query;

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

        async fn subject_stats(
            &self,
            subject: AccountNumber,
        ) -> async_graphql::Result<AttestationStats, async_graphql::Error> {
            Ok(AttestationStatsTable::new()
                .get_index_pk()
                .get(&subject)
                .unwrap())
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
