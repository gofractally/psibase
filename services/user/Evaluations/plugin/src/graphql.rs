use crate::bindings::host::common::server as CommonServer;
use crate::bindings::host::common::types::Error;
use crate::errors::ErrorType;
use crate::types::*;

pub fn fetch_eval(
    owner: psibase::AccountNumber,
    evaluation_id: u32,
) -> Result<GetEvaluation, CommonServer::Error> {
    let query = format!(
        r#"query {{
            getEvaluation(owner: "{owner}", evaluationId: {id}) {{
                numOptions,
            }}
        }}"#,
        owner = owner,
        id = evaluation_id
    );
    GetEvaluation::try_from(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_group_details(
    _owner: psibase::AccountNumber,
    _evaluation_id: u32,
    _group_number: u32,
) -> Result<EvalGroup, CommonServer::Error> {
    // TODO

    return Ok(EvalGroup::default());
}

pub fn fetch_group_proposals(
    _owner: psibase::AccountNumber,
    _evaluation_id: u32,
    _group_number: u32,
) -> Result<UserProposals, CommonServer::Error> {
    // TODO

    return Ok(UserProposals::default());
}

///////

pub fn fetch_eval_and_group(
    owner: psibase::AccountNumber,
    evaluation_id: u32,
    group_number: u32,
) -> Result<EvalInfo, CommonServer::Error> {
    let id = evaluation_id;

    let query = format!(
        r#"query {{
            getEvaluation(owner: "{owner}", evaluationId: {id}) {{
                numOptions
            }}
            getGroup(owner: "{owner}", evaluationId: {id}, groupNumber: {group_number}) {{
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
    EvalInfo::try_from(CommonServer::post_graphql_get_json(&query)?)
}

pub fn fetch_user_settings(
    account_numbers: &Vec<String>,
) -> Result<GetUserSettingsResponse, Error> {
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

pub fn fetch_sym_key_details(
    owner: psibase::AccountNumber,
    evaluation_id: u32,
    group_number: u32,
    user: psibase::AccountNumber,
) -> Option<KeyDetails> {
    let query = format!(
        r#"query {{
            getGroupKey(evaluationOwner: "{owner}", evaluationId: {evaluation_id}, groupNumber: {group_number}, user: "{user}") {{
                key
                keyHash
                salt
            }}
        }}"#,
        owner = owner,
        evaluation_id = evaluation_id,
        group_number = group_number,
        user = user
    );

    let response = CommonServer::post_graphql_get_json(&query).unwrap();
    let key_details = KeyDetailsResponse::try_from(response).unwrap().key_details;
    key_details
}

impl TryFrom<String> for KeyDetailsResponse {
    type Error = Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: ResponseRoot<KeyDetailsResponse> = serde_json::from_str(&response)
            .map_err(|e| ErrorType::GraphQLParseError(format!("KeyHistoryResponse: {}", e)))?;

        Ok(response_root.data)
    }
}
