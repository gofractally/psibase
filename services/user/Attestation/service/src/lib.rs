/// This is another example service that adds and multiplies `i32`
/// numbers, similar to test_contract. This service has additional
/// features such as writing tables, and providing a graphiql
/// query interface.

// #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
// pub struct VerifiableCredential {
//     /// The subject (generally also the holder)
//     subject: AccountNumber,

//     /// The result of the calculation
//     credentialSubject: String,
// }

#[psibase::service(name = "attestation")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::{services::transact, TimePointSec, *};
    use serde::{Deserialize, Serialize};

    #[table(name = "AttestationTable", index = 0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct Attestation {
        /// The attesting account / the issuer
        #[primary_key]
        attester: AccountNumber,

        /// The subject (generally also the holder)
        subject: AccountNumber,

        /// creation/issue time
        // #[secondary_key(2)]
        issued: psibase::TimePointSec,

        /// The result of the calculation
        credentialSubject: String,
    }

    impl Attestation {
        #[secondary_key(1)]
        fn by_id(&self) -> (psibase::TimePointSec, AccountNumber, AccountNumber) {
            (self.issued, self.attester, self.subject)
        }
        #[secondary_key(2)]
        fn by_subject(&self) -> (psibase::TimePointSec, AccountNumber, AccountNumber) {
            (self.issued, self.attester, self.subject)
        }
    }

    #[table(record = "WebContentRow", index = 1)]
    struct WebContentTable;

    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject, Debug, Clone)]
    pub struct VerifiableCredential {
        /// The subject (generally also the holder)
        subject: AccountNumber,

        /// The result of the calculation
        credentialSubject: String,
    }

    #[action]
    pub fn attest(vc: VerifiableCredential) -> TimePointSec {
        let attester = get_sender();
        // let subject = get_sender();
        // let issued = TimePointSec { seconds: 52 };
        let issued = transact::Wrapper::call().currentBlock().time;
        let subject = vc.subject;
        let credentialSubject = vc.credentialSubject.as_str();

        let answer_table = AttestationTable::new();
        answer_table
            .put(&Attestation {
                attester,
                subject,
                issued,
                credentialSubject: String::from(credentialSubject),
            })
            .unwrap();

        Wrapper::emit().history().attest(
            attester,
            subject,
            issued,
            String::from(credentialSubject),
        );

        issued
    }

    #[event(history)]
    pub fn attest(
        id: AccountNumber,
        subject: AccountNumber,
        issued: TimePointSec,
        credentialSubject: String,
    ) {
    }

    struct Query;

    #[Object]
    impl Query {
        async fn attestation(&self, attestedAccount: AccountNumber) -> Option<Attestation> {
            AttestationTable::new().get_index_pk().get(&attestedAccount)
        }

        // async fn answers(&self, account: AccountNumber) -> Option<Vec<i32>> {
        //     let answer_table = AnswerTable::new();
        //     let tab = answer_table.get_index_pk();

        //     Some(tab.iter().map(|val| val.result).collect())
        // }

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
    }

    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(get_sender() == get_service(), "unauthorized");
        let table = WebContentTable::new();
        store_content(path, contentType, content, &table).unwrap();
    }
}
