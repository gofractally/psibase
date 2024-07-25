use async_graphql::SimpleObject;
/// Identity service to log identity attestations, and provide a graphiql
/// query interface.
use psibase::fracpack::*;
use psibase::AccountNumber;
use psibase_macros::Reflect;
use serde::{Deserialize, Serialize};

#[derive(Pack, Unpack, Reflect, Deserialize, Serialize, SimpleObject, Debug, Clone, ToSchema)]
#[allow(non_snake_case)]
/// Given get_sender() gives us a verified `attester`, and
/// the credentialSubject contains the subject / attestee,
/// we only need the "claims" being made.
pub struct Credential {
    /// The subject (generally also the holder)
    /// The claims being attested to (includes subject)
    subject: AccountNumber,
    value: u8,
}

#[psibase::service(name = "identity")]
#[allow(non_snake_case)]
mod service {
    use std::str::FromStr;

    use async_graphql::connection::Connection;
    use async_graphql::*;
    use psibase::{services::transact, TimePointSec, *};
    use serde::{Deserialize, Serialize};

    #[table(name = "AttestationTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone, Default)]
    pub struct Attestation {
        /// The attesting account / the issuer
        attester: AccountNumber,

        /// creation/issue time
        issued: psibase::TimePointSec,

        /// The credential subject, in this case, the subject/attestee
        subject: AccountNumber,

        value: u8,
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

    #[table(name = "AttestationStatsTable", index = 1)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone, Default)]
    pub struct AttestationStats {
        /// The credential subject, in this case, the subject/attestee
        #[primary_key]
        subject: AccountNumber,

        // % high conf + # unique attestations will give an approximation of a Google Review for a user
        perc_high_conf: u8,

        unique_attestations: u16,

        // freshness indicator
        most_recent_attestation: TimePointSec,
    }

    #[table(record = "WebContentRow", index = 2)]
    struct WebContentTable;

    fn update_attestation_stats(
        subj_acct: AccountNumber,
        is_unique_attester_for_subj: bool,
        value: u8,
        issued: TimePointSec,
    ) -> Result<(), _> {
        let attestation_stats_table = AttestationStatsTable::new();
        let stats_rec = attestation_stats_table.get_index_pk().get(&(subj_acct));

        match stats_rec {
            // there exists a stats entry for this subject
            Some(stats_rec) => {
                let new_unique_attests = if is_unique_attester_for_subj {
                    // case: c => new unique attester for existing attestee
                    // This is updating an existing attestation and existing stats record
                    // update AttestationStats fields
                    stats_rec.unique_attestations + 1
                } else {
                    // This attestation doesn't replace an existing;
                    // update AttestationStats fields
                    stats_rec.unique_attestations
                };
                let new_perc_high_conf = match value {
                    conf if conf > 75 => {
                        ((stats_rec.perc_high_conf as u16 * stats_rec.unique_attestations
                            + value as u16)
                            / new_unique_attests) as u8
                    }
                    _ => {
                        (stats_rec.perc_high_conf as u16 * stats_rec.unique_attestations
                            / new_unique_attests) as u8
                    }
                };
                attestation_stats_table.put(&AttestationStats {
                    subject: stats_rec.subject,
                    perc_high_conf: new_perc_high_conf,
                    unique_attestations: new_unique_attests,
                    most_recent_attestation: issued,
                })
            }
            None => {
                // case: a and b => first stats entry for this subject
                attestation_stats_table.put(&AttestationStats {
                    subject: subj_acct,
                    perc_high_conf: value,
                    unique_attestations: 1,
                    most_recent_attestation: issued,
                });
                psibase::abort_message(message)
            }
        }
    }

    #[action]
    pub fn attest(subject: String, value: u8) {
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;

        let attestation_table = AttestationTable::new();

        let subj_acct = match AccountNumber::from_str(&subject.clone()) {
            Ok(subject_acct) => subject_acct,
            // TODO
            Err(e) => psibase::abort_message(&format!("{}", e)),
        };

        let existing_rec = attestation_table.get_index_pk().get(&(subj_acct, attester));

        attestation_table
            .put(&Attestation {
                attester,
                issued,
                subject: subj_acct,
                value,
            })
            .unwrap();

        // Update Attestation stats
        update_attestation_stats(subj_acct, existing_rec.is_some(), value, issued);
        // if attester-subject pair already in table, recalc %high_conf if necessary based on new score
        // if attester-subject pair not in table, increment unique attestations and calc new %high_conf score

        // subject: AccountNumber,
        // perc_high_conf: u16,
        // unique_attestations: u16,  size of index of attestee = <something>
        // most_recent_attestation -- for freshness of attestation

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
