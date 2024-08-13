pub fn get_gql_query_attestations_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!(
        "query {{ {}({}: \"{}\") {{ nodes {{ attester, subject, value, issued {{ seconds }} }} }} }}",
        query_name, param_name, param
    )
}

pub fn get_gql_query_attestations_no_args(query_name: String) -> String {
    format!(
        "query {{ {} {{ nodes {{ attester, subject, value, issued {{ seconds }} }} }} }}",
        query_name
    )
}

pub fn get_gql_query_attestation_stats_no_args(query_name: &str) -> String {
    format!("query {{ {} {{ nodes {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }} }}",
    query_name)
}

pub fn get_gql_query_subject_stats_one_arg(
    query_name: &str,
    param_name: &str,
    param: &str,
) -> String {
    format!("query {{ {}({}: \"{}\") {{ subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation {{ seconds }} }} }}",
    query_name, param_name, param)
}
