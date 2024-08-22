use crate::tests::helpers::test_helpers::HasQueryFields;

pub fn get_query<T>(returns_list: bool, query_name: &str, params: &[(&str, &str)]) -> String
where
    T: HasQueryFields,
{
    let formatted_params = if params.is_empty() {
        String::new()
    } else {
        params
            .iter()
            .map(|(name, value)| format!("{}: \"{}\"", name, value))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let params_part = if formatted_params.is_empty() {
        String::new()
    } else {
        format!("({})", formatted_params)
    };

    let fields_part = if returns_list {
        format!("nodes {{ {} }}", T::QUERY_FIELDS)
    } else {
        format!("{}", T::QUERY_FIELDS)
    };

    format!(
        "query {{ {}{} {{ {} }} }}",
        query_name, params_part, fields_part
    )
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
        let is_list = true;
        let query = get_query::<T>(is_list, query_name, params);
        let res: serde_json::Value = chain.graphql(service, &query).unwrap();
        serde_json::from_value::<Self::Output>(res["data"][query_name]["nodes"].clone()).unwrap()
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
        let is_list = false;
        let query = get_query::<T>(is_list, query_name, params);
        let res: serde_json::Value = chain.graphql(service, &query).unwrap();
        serde_json::from_value::<Self::Output>(res["data"][query_name].clone()).unwrap()
    }
}
