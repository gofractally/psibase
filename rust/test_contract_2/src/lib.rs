
/// This is another example service that adds and multiplies `i32` 
/// numbers, similar to test_contract. This service has additional
/// features such as writing tables, and providing a graphiql
/// query interface.
#[psibase::service]
#[allow(non_snake_case)]
mod service {
    use psibase::*;
    use serde::{Serialize, Deserialize};
    use async_graphql::*;

    /// Holds an answer to a calculation done by an account `id`
    #[table(name="AnswerTable", index=0)]
    #[derive(Fracpack, Reflect, Serialize, Deserialize, SimpleObject)]
    pub struct Answer {
        
        /// The account responsible for the calculation
        #[primary_key]
        id: AccountNumber,

        /// The result of the calculation
        result: i32,
    }

    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        let res = a + b;

        let answer_table = AnswerTable::new();
        answer_table.put(&Answer{
            id : get_sender(),
            result : res,
        }).unwrap();

        res

    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        let res = a * b;

        let answer_table = AnswerTable::new();
        answer_table.put(&Answer{
            id : get_sender(),
            result : res,
        }).unwrap();

        res
    }

    struct Query;

    #[Object]
    impl Query {
        /// Get the answer to `account`'s most recent calculation
        async fn answer(&self, account : AccountNumber) -> Option<Answer> {
            AnswerTable::new().get_index_pk().get(&account)
        }
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_simple_ui::<Wrapper>(&request))
            .or_else(|| serve_graphql(&request, Query))
            .or_else(|| serve_graphiql(&request))
    }
}

// TODO: testing not working
// #[psibase::test_case(services("example"))]
// fn test_arith(chain: psibase::Chain) -> Result<(), psibase::Error> {
//     let result = Wrapper::push(&chain).add(3, 4);
//     assert_eq!(result.get()?, 7);
//     println!("\n\nTrace:\n{}", result.trace);

//     Ok(())
// }
