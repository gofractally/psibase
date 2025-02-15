use crate::tests::helpers::test_helpers::HasQueryFields;

fn execute_query(
    chain: &psibase::Chain,
    service: psibase::AccountNumber,
    query: &str,
    query_fields: &str,
) -> serde_json::Value {
    let query = format!("query {{ {} {{ {} }} }}", query, query_fields);
    chain.graphql(service, &query).unwrap()
}

pub trait Queryable {
    fn query(chain: &psibase::Chain, service: psibase::AccountNumber, query: &str) -> Self;
}
impl<T> Queryable for Vec<T>
where
    T: serde::de::DeserializeOwned + HasQueryFields,
{
    fn query(chain: &psibase::Chain, service: psibase::AccountNumber, query: &str) -> Self {
        let query_name = match query.find('(') {
            Some(index) => &query[..index],
            None => query,
        };

        let fields_part = format!("nodes {{ {} }}", T::QUERY_FIELDS);
        let res = execute_query(chain, service, query, &fields_part);
        let data = res["data"][query_name]["nodes"].clone();
        serde_json::from_value::<Self>(data)
            .map_err(|e| {
                println!("Response: {}", res);
                println!("Error: {}", e);
                e
            })
            .unwrap()
    }
}
impl<T> Queryable for Option<T>
where
    T: serde::de::DeserializeOwned + HasQueryFields,
{
    fn query(chain: &psibase::Chain, service: psibase::AccountNumber, query: &str) -> Self {
        let query_name = match query.find('(') {
            Some(index) => &query[..index],
            None => query,
        };
        let fields_part = format!("{}", T::QUERY_FIELDS);
        let res = execute_query(chain, service, query, &fields_part);
        let data = res["data"][query_name].clone();
        serde_json::from_value::<Self>(data)
            .map_err(|e| {
                println!("Response: {}", res);
                println!("Error: {}", e);
                e
            })
            .unwrap()
    }
}
