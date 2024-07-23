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

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    pub fn attest(subject: String, value: u8) {
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;

        let attestation_table = AttestationTable::new();

        let subj_acct = match AccountNumber::from_str(&subject.clone()) {
            Ok(subject_acct) => subject_acct,
            Err(_subject_acct) => return,
        };

        attestation_table
            .put(&Attestation {
                attester,
                issued,
                subject: subj_acct,
                value,
            })
            .unwrap();

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

        // query only most recent from each attester (there's only 1 entry per attester)
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
