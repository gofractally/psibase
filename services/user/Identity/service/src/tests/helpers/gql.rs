use crate::tests::helpers::test_helpers::HasQueryFields;

fn format_params(params: &[(&str, &str)]) -> String {
    let formatted_params = if params.is_empty() {
        String::new()
    } else {
        params
            .iter()
            .map(|(name, value)| format!("{}: \"{}\"", name, value))
            .collect::<Vec<_>>()
            .join(", ")
    };

    if formatted_params.is_empty() {
        String::new()
    } else {
        format!("({})", formatted_params)
    }
}

fn execute_query(
    chain: &psibase::Chain,
    service: psibase::AccountNumber,
    query_name: &str,
    params: &[(&str, &str)],
    query_fields: &str,
) -> serde_json::Value {
    let params_part = format_params(params);

    let query = format!(
        "query {{ {}{} {{ {} }} }}",
        query_name, params_part, query_fields
    );

    chain.graphql(service, &query).unwrap()
}

pub trait Queryable {
    type Output;

    fn query(
        chain: &psibase::Chain,
        service: psibase::AccountNumber,
        query_name: &str,
        params: &[(&str, &str)],
    ) -> Self::Output;
}
impl<T> Queryable for Vec<T>
where
    T: serde::de::DeserializeOwned + HasQueryFields,
{
    type Output = Vec<T>;

    fn query(
        chain: &psibase::Chain,
        service: psibase::AccountNumber,
        query_name: &str,
        params: &[(&str, &str)],
    ) -> Self::Output {
        let fields_part = format!("nodes {{ {} }}", T::QUERY_FIELDS);
        let res = execute_query(chain, service, query_name, params, &fields_part);
        let data = res["data"][query_name]["nodes"].clone();
        serde_json::from_value::<Self::Output>(data).unwrap()
    }
}
impl<T> Queryable for Option<T>
where
    T: serde::de::DeserializeOwned + HasQueryFields,
{
    type Output = Option<T>;

    fn query(
        chain: &psibase::Chain,
        service: psibase::AccountNumber,
        query_name: &str,
        params: &[(&str, &str)],
    ) -> Self::Output {
        let fields_part = format!("{}", T::QUERY_FIELDS);
        let res = execute_query(chain, service, query_name, params, &fields_part);
        let data = res["data"][query_name].clone();
        serde_json::from_value::<Self::Output>(data).unwrap()
    }
}
