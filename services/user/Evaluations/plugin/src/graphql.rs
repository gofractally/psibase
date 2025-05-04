use crate::bindings::host::common::server as CommonServer;
use crate::bindings::host::common::types::Error;
use crate::types::*;

pub fn fetch_and_decode(
    owner: psibase::AccountNumber,
    evaluation_id: u32,
    group_number: u32,
) -> Result<Data, CommonServer::Error> {
    let id = evaluation_id;

    let query = format!(
        r#"query {{
            getEvaluation(owner: "{owner}", evaluationId: {id}) {{
                numOptions
            }}
            getGroup(owner: "{owner}", evaluationId: {id}, groupNumber: {group_number}) {{
                evaluationId
                keySubmitter
            }}
            getGroupUsers(owner: "{owner}", evaluationId: {id}, groupNumber: {group_number}) {{
                nodes {{
                    user
                    attestation
                    proposal
                }}
            }}
        }}"#,
        owner = owner,
        id = id,
        group_number = group_number
    );
    Data::try_from(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_user_settings(account_numbers: Vec<String>) -> Result<GetUserSettingsResponse, Error> {
    let query = format!(
        r#"query {{
            getUserSettings(accounts: [{account_numbers}]) {{
                user
                key
            }}
        }}"#,
        account_numbers = account_numbers
            .iter()
            .map(|acc| format!("\"{}\"", acc))
            .collect::<Vec<_>>()
            .join(",")
    );
    GetUserSettingsResponse::try_from(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_key_history(
    owner: psibase::AccountNumber,
    evaluation_id: u32,
    group_number: u32,
) -> Result<KeyHistoryResponse, Error> {
    let query = format!(
        r#"query {{
            getGroupKey(evaluationOwner: "{owner}", evaluationId: {evaluation_id}, groupNumber: {group_number}) {{
                edges {{
                    node {{
                        evaluationId
                        hash
                        groupNumber
                        keys
                    }}
                }}
            }}
        }}"#,
        owner = owner,
        evaluation_id = evaluation_id,
        group_number = group_number
    );

    KeyHistoryResponse::try_from(CommonServer::post_graphql_get_json(&query)?)
}
