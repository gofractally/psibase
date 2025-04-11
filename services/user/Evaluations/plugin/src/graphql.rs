use crate::bindings::host::common::server as CommonServer;
use crate::bindings::host::common::types::Error;
use crate::types::*;

pub fn fetch_and_decode(
    evaluation_id: u32,
    group_number: u32,
) -> Result<GetEvaluationResponse, CommonServer::Error> {
    let id = evaluation_id;

    let query = format!(
        r#"query {{
            getEvaluation(id: {id}) {{
                rankAmount
            }}
            getGroup(id: {id}, groupNumber: {group_number}) {{
                evaluationId
                keySubmitter
            }}
            getGroupUsers(id: {id}, groupNumber: {group_number}) {{
                user
                submission
                proposal
            }}
        }}"#,
        id = id,
        group_number = group_number
    );
    GetEvaluationResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_user_settings(account_numbers: Vec<String>) -> Result<GetUserSettingsResponse, Error> {
    let query = format!(
        r#"query {{
            getUserSettings(accountNumbers: [{account_numbers}]) {{
                user
                key
            }}
        }}"#,
        account_numbers = account_numbers.join(",")
    );
    GetUserSettingsResponse::from_gql(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_key_history() -> Result<KeyHistoryResponse, Error> {
    let query = format!(
        r#"query {{
            getGroupKey(first: 99) {{
                edges {{
                    node {{
                        evaluationId
                        hash
                        groupNumber
                        keys
                    }}
                }}
            }}
        }}"#
    );

    KeyHistoryResponse::try_from(CommonServer::post_graphql_get_json(&query)?)
}
