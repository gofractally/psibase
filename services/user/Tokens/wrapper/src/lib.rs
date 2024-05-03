#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use async_graphql::*;
    use psibase::*;
    use psibase_macros::Reflect as ReflectTwo;

    use serde::{Deserialize, Serialize};

    // #[table(name = "BalanceTable", index = 0)]
    // #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject)]
    // pub struct Balance {
    //     #[primary_key]
    //     owner: AccountNumber;

    // }

    #[table(record = "WebContentRow", index = 0)]
    struct WebContentTable;

    #[action]
    pub fn credit(from: AccountNumber, to: AccountNumber) -> i32 {}

    #[action]
    pub fn create(precision: Precision, maxSupply: Quantity) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_content(&request, &WebContentTable::new()))
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
