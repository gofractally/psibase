use async_graphql::SimpleObject;
/// This is another example service that adds and multiplies `i32`
/// numbers, similar to test_contract. This service has additional
/// features such as writing tables, and providing a graphiql
/// query interface.
use psibase::fracpack::*;
use psibase_macros::Reflect;
use serde::{Deserialize, Serialize};

#[derive(Pack, Unpack, Reflect, Deserialize, Serialize, SimpleObject, Debug, Clone)]
#[allow(non_snake_case)]
pub struct VerifiableCredential {
    /// The subject (generally also the holder)
    // pub subject: AccountNumber,

    /// The claims being attested to
    pub credentialSubject: String,
}

#[psibase::service(name = "attestation")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::connection::Connection;
    use async_graphql::*;
    use psibase::{services::transact, TimePointSec, *};
    use serde::{Deserialize, Serialize};
    use services::transact::auth_interface::FIRST_AUTH_FLAG;

    #[table(name = "AttestationTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct Attestation {
        #[primary_key]
        id: u64,

        /// The attesting account / the issuer
        attester: AccountNumber,

        /// The subject (generally also the holder)
        // subject: AccountNumber,

        /// creation/issue time
        // #[secondary_key(2)]
        issued: psibase::TimePointSec,

        /// The result of the calculation
        credentialSubject: String,
    }

    impl Attestation {
        #[secondary_key(1)]
        fn by_attester(&self) -> (AccountNumber, u64) {
            //, AccountNumber) {
            (self.attester, self.id) //, self.subject)
        }
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[action]
    pub fn attest(vc: crate::VerifiableCredential) {
        psibase::write_console("Attestation[service].attest()");
        let attester = get_sender();
        let issued = transact::Wrapper::call().currentBlock().time;
        // let subject = vc.subject;
        let credentialSubject = vc.credentialSubject.as_str();

        let attestation_table = AttestationTable::new();
        let pk_table_idx = attestation_table.get_index_pk();
        let lastRec = pk_table_idx.iter().last();
        let last_id = lastRec
            .unwrap_or(Attestation {
                id: u64::MAX,
                attester: AccountNumber::from(""),
                issued: TimePointSec::from(0),
                credentialSubject: "".to_string(),
            })
            .id;
        let next_id = last_id + 1;

        // Update lastMessageId
        attestation_table
            .put(&Attestation {
                id: next_id,
                attester,
                // subject,
                issued,
                credentialSubject: String::from(credentialSubject),
            })
            .unwrap();

        Wrapper::emit().history().attest(
            attester,
            // subject,
            issued,
            String::from(credentialSubject),
        );
    }

    #[event(history)]
    pub fn attest(
        id: AccountNumber,
        // subject: AccountNumber,
        issued: TimePointSec,
        credentialSubject: String,
    ) {
    }

    struct Query;

    #[Object]
    impl Query {
        // async fn attestation(
        //     &self,
        //     n: usize,
        //     attester: AccountNumber,
        //     // ) -> async_graphql::Result<Vec<Attestation>, async_graphql::Error> {
        // ) -> Vec<Attestation> {
        //     // let mytuple: (AccountNumber,) = (attester,);
        //     // AttestationTable::new()
        //     //     .get_index_by_attester()
        //     //     .get(&mytuple)

        //     // TableQuery::subindex::<u64>(AttestationTable::new().get_index_by_attester(), &attester)
        //     //     .first(Some(1))

        //     // AttestationTable::new()
        //     //     .get_index_by_attester()
        //     //     .iter()
        //     //     .take(n)
        //     //     .collect::<Vec<Attestation>>()

        //     // .query()
        //     // .await

        //     write_console("Query.attestation()");

        //     // works
        //     let obj1 = AttestationTable::new().get_index_pk();
        //     // .iter().take(1);
        //     // not works
        //     let obj2 = AttestationTable::new()
        //         .get_index_by_attester()
        //         .iter()
        //         .take(1)
        //         .collect();
        //     // works
        //     let obj3 = TableQuery::subindex::<u64>(
        //         AttestationTable::new().get_index_by_attester(),
        //         &attester,
        //     );
        //     // .iter()
        //     // .take(1);

        //     AttestationTable::new()
        //         .get_index_pk()
        //         .iter()
        //         .take(1)
        //         .collect()

        //     // let first_attestation: Vec<Attestation> = AttestationTable::new()
        //     //     .get_index_by_attester()
        //     //     .iter()
        //     //     .take(1)
        //     //     .collect();
        //     // first_attestation[0].clone()
        // }

        async fn attestations(
            &self,
            attester: AccountNumber,
            first: Option<i32>,
            last: Option<i32>,
            before: Option<String>,
            after: Option<String>,
        ) -> async_graphql::Result<Connection<RawKey, Attestation>> {
            write_console("Query.attestations()");
            TableQuery::subindex::<u64>(AttestationTable::new().get_index_by_attester(), &attester)
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
