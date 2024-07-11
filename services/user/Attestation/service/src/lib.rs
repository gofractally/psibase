use async_graphql::SimpleObject;
/// Attestation service to log attestations, and providing a graphiql
/// query interface.
use psibase::fracpack::*;
use psibase_macros::Reflect;
use serde::{Deserialize, Serialize};

#[derive(Pack, Unpack, Reflect, Deserialize, Serialize, SimpleObject, Debug, Clone, ToSchema)]
#[allow(non_snake_case)]
/// Given get_sender() gives us a verified `attester`, and
/// the credentialSubject contains the subject / attestee,
/// we only need the "claims" being made.
pub struct VerifiableCredential {
    /// The subject (generally also the holder)
    /// The claims being attested to (includes subject)
    pub credentialSubject: String,
}

#[psibase::service(name = "attestation")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use psibase::{services::transact, TimePointSec, *};
    use serde::{Deserialize, Serialize};

    #[table(name = "AttestationTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct Attestation {
        #[primary_key]
        id: u64,

        /// The attesting account / the issuer
        attester: AccountNumber,

        /// creation/issue time
        issued: psibase::TimePointSec,

        /// The credential subject, which includes the subject/attestee as well as the claim being made
        credentialSubject: String,
    }

    impl Attestation {
        #[secondary_key(1)]
        fn by_attester(&self) -> (AccountNumber, u64) {
            (self.attester, self.id)
        }
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    pub fn attest(vc: crate::VerifiableCredential) {
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;
        let credentialSubject = vc.credentialSubject.as_str();

        let attestation_table = AttestationTable::new();
        let pk_table_idx = attestation_table.get_index_pk();
        let lastRec = pk_table_idx.iter().last();
        // TODO: Is there a better way to do this, i.e., a way that doesn't unnecessarily create a bunch of unused, temporary values?
        let last_id = lastRec
            .unwrap_or(Attestation {
                id: u64::MAX,
                attester: AccountNumber::from(""),
                issued: TimePointSec::from(0),
                credentialSubject: "".to_string(),
            })
            .id;
        let next_id = last_id + 1;

        // TODO: Update summary stats
        // Q: Will this *update* or just add?
        // Perhaps the attester should be the primary key? because we're only interested in the *latest* attestation from each attester;
        // all other attestation data will be history, accessed via event queries
        attestation_table
            .put(&Attestation {
                id: next_id,
                attester,
                issued,
                credentialSubject: String::from(credentialSubject),
            })
            .unwrap();

        Wrapper::emit()
            .history()
            .attest(attester, issued, String::from(credentialSubject));
    }

    #[event(history)]
    pub fn attest(id: AccountNumber, issued: TimePointSec, credentialSubject: String) {}

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
            TableQuery::subindex::<u64>(AttestationTable::new().get_index_by_attester(), &attester)
                .first(first)
                .last(last)
                .before(before)
                .after(after)
                .query()
                .await
        }

        async fn attestations_by_attestee(
            &self,
            attestation_type: String,
            attestee: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
            return Err(async_graphql::Error::new(
                "attestations_by_attestee not yet implemented",
            ));
        }

        async fn summary(
            &self,
            attestation_type: String,
            attestee: String,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
            return Err(async_graphql::Error::new("summary() not yet implemented"));
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
