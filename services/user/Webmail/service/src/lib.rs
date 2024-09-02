use psibase::services::accounts::Wrapper as AccountsSvc;
use psibase::AccountNumber;

fn validate_user(user: String) -> bool {
    let acc = AccountNumber::from(user.as_str());
    if acc.to_string() != user {
        return false;
    }

    AccountsSvc::call().exists(acc)
}

#[psibase::service]
mod service {
    use async_graphql::{Object, SimpleObject};
    use psibase::{
        anyhow, check, get_sender, get_service, serve_content, serve_graphiql, serve_graphql,
        serve_simple_ui, store_content, AccountNumber, Fracpack, HexBytes, HttpReply, HttpRequest,
        SingletonKey, Table, ToSchema, WebContentRow,
    };
    use serde::{Deserialize, Serialize};

    use crate::validate_user;

    // #[table(name = "InitTable")]
    // #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    // pub struct Init {
    //     inited: bool,
    // }

    // impl Init {
    //     #[primary_key]
    //     fn by_key(&self) -> SingletonKey {
    //         SingletonKey {}
    //     }
    // }

    // impl Default for Init {
    //     fn default() -> Self {
    //         Init { inited: false }
    //     }
    // }

    #[table(record = "WebContentRow")]
    struct WebContentTable;

    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(
            validate_user(receiver.to_string()),
            &format!("receiver account {} doesn't exist", receiver),
        );
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body);
    }

    #[event(history)]
    pub fn sent(sender: AccountNumber, receiver: AccountNumber, subject: String, body: String) {}

    struct Query;

    #[Object]
    impl Query {
        async fn getMessages(&self) -> async_graphql::Result<String, async_graphql::Error> {
            // let curr_val = InitTable::new().get_index_pk().get(&SingletonKey {});
            // Ok(match curr_val {
            //     Some(val) => val.name,
            //     None => String::from("psibase"),
            // })
            Ok(String::from("placeholder"))
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
            .or_else(|| serve_simple_ui::<Wrapper>(&request))
        // .or_else(|| serve_rest_api)
    }

    #[action]
    #[allow(non_snake_case)]
    fn storeSys(path: String, contentType: String, content: HexBytes) {
        check(get_sender() == get_service(), "unauthorized");
        let table = WebContentTable::new();
        store_content(path, contentType, content, &table).unwrap();
    }
}
