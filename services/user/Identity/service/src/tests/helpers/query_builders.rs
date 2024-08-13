const ATTESTATION_FIELDS: &str = "attester, subject, value, issued { seconds }";
const ATTESTATION_STATS_FIELDS: &str =
    "subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds }";

pub fn get_gql_query_attestations_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!(
        "query {{ {}({}: \"{}\") {{ nodes {{ {} }} }} }}",
        query_name, param_name, param, ATTESTATION_FIELDS,
    )
}

pub fn get_gql_query_attestations_no_args(query_name: String) -> String {
    format!(
        "query {{ {} {{ nodes {{ {} }} }} }}",
        query_name, ATTESTATION_FIELDS
    )
}

pub fn get_gql_query_attestation_stats_no_args(query_name: &str) -> String {
    format!(
        "query {{ {} {{ nodes {{ {} }} }} }}",
        query_name, ATTESTATION_STATS_FIELDS
    )
}

pub fn get_gql_query_subject_stats_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!(
        "query {{ {}({}: \"{}\") {{ {} }} }}",
        query_name, param_name, param, ATTESTATION_STATS_FIELDS
    )
}
