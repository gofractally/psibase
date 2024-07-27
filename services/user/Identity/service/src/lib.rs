use std::any::Any;

use psibase::AccountNumber;

/// Identity service to log identity attestations, and provide a graphiql
/// query interface.
#[psibase::service(name = "identity")]
#[allow(non_snake_case)]
mod service {
    use core::fmt;
    use std::str::FromStr;

    use async_graphql::connection::Connection;
    use async_graphql::*;
    use psibase::{services::transact, AccountNumber, TimePointSec, *};
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
        subject: AccountNumber,

        // % high conf + # unique attestations will give an approximation of a Google Review for a user
        perc_high_conf: u8,

        unique_attesters: u16,

        // freshness indicator
        most_recent_attestation: TimePointSec,
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

    fn remove_attestation_from_stats(stats_rec: &mut AttestationStats) -> &mut AttestationStats {
        // REMINDER: I broke the math here when I used u16 to truncate; perhaps I just wipe the chain instead of fix data in table with code... or just create new accounts to work with clean attestatations
        let num_high_conf =
            stats_rec.perc_high_conf as f32 / 100.0 * stats_rec.unique_attesters as f32;
        stats_rec.unique_attesters -= 1;
        stats_rec.perc_high_conf = if stats_rec.unique_attesters == 0 {
            0
        } else {
            println!(
                "num_high_conf: {}, unique_attesters: {} = new % high conf: {}",
                num_high_conf,
                stats_rec.unique_attesters,
                (num_high_conf / stats_rec.unique_attesters as f32 * 100.0) as u8
            );
            (num_high_conf / stats_rec.unique_attesters as f32 * 100.0) as u8
        };
        stats_rec
    }

    fn get_num_high_conf_attestations(perc_high_conf: u8, unique_attesters: u16) -> f32 {}

    fn add_attestation_to_stats(
        stats_rec: &mut AttestationStats,
        subject: AccountNumber,
        value: u8,
        issued: TimePointSec,
    ) -> &AttestationStats {
        stats_rec.subject = subject;
        stats_rec.most_recent_attestation = issued;
        println!("value: {}", value);
        stats_rec.perc_high_conf = if value > 75 {
            ((stats_rec.perc_high_conf as f32 / 100.0 * stats_rec.unique_attesters as f32 + 1.0)
                / (stats_rec.unique_attesters as f32 + 1.0) as f32
                * 100.0)
                .round() as u8
        } else {
            ((stats_rec.perc_high_conf as f32 / 100.0 * stats_rec.unique_attesters as f32)
                / (stats_rec.unique_attesters as f32 + 1.0)
                * 100.0)
                .round() as u8
        };
        stats_rec.unique_attesters += 1;
        stats_rec
    }

    fn update_attestation_stats(
        subj_acct: AccountNumber,
        is_new_unique_attester_for_subj: bool,
        value: u8,
        issued: TimePointSec,
    ) {
        let attestation_stats_table = AttestationStatsTable::new();
        let mut stats_rec = attestation_stats_table
            .get_index_pk()
            .get(&(subj_acct))
            .unwrap_or_default();
        println!("at start:\n{}", stats_rec);
        // STEPS:
        // 1) ensure the table has a default state (do this as an impl on the table)
        //  -- This is handled by Default impl
        // 2) if this is a new attestation for an existing subject; remove stat that this entry will replace
        println!(
            "is_unique: {}, # unique: {}",
            is_new_unique_attester_for_subj, stats_rec.unique_attesters
        );
        if !is_new_unique_attester_for_subj && stats_rec.unique_attesters > 0 {
            println!("have records; is not unique; removing attestation from stats...");
            remove_attestation_from_stats(&mut stats_rec);
        }
        println!("after removing existing:\n{}", stats_rec);

        // 3) update stats to include this attestation
        add_attestation_to_stats(&mut stats_rec, subj_acct, value, issued);

        println!("new % conf: {}", stats_rec.perc_high_conf);
        println!("after:\n{}", stats_rec);

        let _ = attestation_stats_table
            .put(&stats_rec)
            .map_err(|e| psibase::abort_message(&format!("{}", e)));
    }

    #[action]
    pub fn attest(subject: String, value: u8) {
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;

        let attestation_table = AttestationTable::new();

        let subj_acct = match AccountNumber::from_str(&subject.clone()) {
            Ok(subject_acct) => subject_acct,
            Err(e) => psibase::abort_message(&format!("{}", e)),
        };

        println!(
            "checking for existing attestation: ({}, {})",
            subj_acct, attester
        );

        let existing_rec = attestation_table.get_index_pk().get(&(subj_acct, attester));
        let is_unique_attester = existing_rec.is_none();
        if existing_rec.is_some() {
            println!("Existing Attestation rec: {}", existing_rec.unwrap());
        } else {
            println!("No existing Attestation rec...");
        }

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

fn test_attest(
    chain: psibase::Chain,
    attester: AccountNumber,
    subject: String,
    conf: u8,
) -> Result<(), psibase::Error> {
    use psibase::services::http_server;

    http_server::Wrapper::push_to(&chain, SERVICE).registerServer(SERVICE);
    let result = Wrapper::push_from(&chain, attester).attest(subject, conf);
    assert_eq!(result.get()?, ());
    println!("\n\nTrace:\n{}", result.trace);

    chain.finish_block();
    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_high_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use serde_json::{json, Value};

    test_attest(chain, AccountNumber::from("alice"), String::from("bob"), 95)?;

    return Ok(());
    // TODO: handle 404 the following code causes
    let reply: Value = chain.graphql(
        SERVICE,
        // r#"query { allAttestationStats { subject, uniqueAttesters } }"#,
        r#"query { allAttestations { attester subject value } }"#,
    )?;
    println!("graphql reply: {}", reply);
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationsStats": {"uniqueAttesters": 1} } })
    );

    Ok(())
}

#[psibase::test_case(services("identity"))]
pub fn test_attest_low_conf(chain: psibase::Chain) -> Result<(), psibase::Error> {
    use serde_json::{json, Value};

    test_attest(chain, AccountNumber::from("alice"), String::from("bob"), 75)?;

    return Ok(());
    // TODO: handle 404 the following code causes
    let reply: Value = chain.graphql(
        SERVICE,
        // r#"query { allAttestationStats { subject, uniqueAttesters } }"#,
        r#"query { allAttestations { attester subject value } }"#,
    )?;
    println!("graphql reply: {}", reply);
    assert_eq!(
        reply,
        json!({ "data": { "allAttestationsStats": {"uniqueAttesters": 1} } })
    );

    Ok(())
}
