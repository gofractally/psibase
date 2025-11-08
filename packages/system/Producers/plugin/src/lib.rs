#[allow(warnings)]
mod bindings;
use bindings::*;

use crate::bindings::host::common::client as Client;

use psibase::services::auth_sig::SubjectPublicKeyInfo;

use host::common::server::post_graphql_get_json;
use host::types::types::Error;
use transact::plugin::intf::add_action_to_transaction;

use exports::producers::plugin::api::Guest as Api;
use producers::plugin::types::*;

use psibase::fracpack::Pack;
use psibase::services;
use psibase::AccountNumber;
use serde::Deserialize;
use services::producers::action_structs as Actions;

use psibase::Producer;

mod errors;
use errors::ErrorType::*;

struct ProducersPlugin;

#[derive(Deserialize)]
struct CandidateLookupClaim {
    service: String,
    #[serde(rename = "rawData")]
    raw_data: String,
}

#[derive(Deserialize)]
struct CandidateLookupCandidateInfo {
    account: String,
    claim: CandidateLookupClaim,
}

#[derive(Deserialize)]
struct CandidateLookupResponse {
    #[serde(default)]
    data: CandidateLookupData,
}

#[derive(Default, Deserialize)]
struct CandidateLookupData {
    #[serde(rename = "candidatesInfo")]
    candidates_info: Vec<CandidateLookupCandidateInfo>,
}

impl ProducersPlugin {
    fn candidates_claims(accounts: &Vec<String>) -> Result<Vec<(String, psibase::Claim)>, Error> {
        let query = format!(
            r#"query {{
            candidatesInfo(names: [{names}]) {{
                account
                claim {{
                    service
                    rawData
                }}
            }}
        }}"#,
            names = accounts
                .iter()
                .map(|name| format!("\"{}\"", name))
                .collect::<Vec<_>>()
                .join(",")
        );

        let response = post_graphql_get_json(&query)?;
        let response: CandidateLookupResponse =
            serde_json::from_str(&response).map_err(|e| InvalidResponse(e.to_string()))?;
        let claims = response.data.candidates_info;

        if claims.len() != accounts.len() {
            return Err(InvalidResponse(format!("Some candidate(s) not found")).into());
        }

        let mut result: Vec<(String, psibase::Claim)> = vec![];
        for candidate_info in claims {
            let der_bytes = hex::decode(&candidate_info.claim.raw_data)
                .map_err(|e| InvalidResponse(format!("Invalid hex in candidate data: {}", e)))?;
            let spki = SubjectPublicKeyInfo(der_bytes);

            let claim = psibase::Claim {
                service: AccountNumber::from(candidate_info.claim.service.as_str()),
                rawData: spki.0.into(),
            };

            result.push((candidate_info.account, claim));
        }

        Ok(result)
    }

    fn lookup_candidates(accounts: &Vec<String>) -> Result<Vec<psibase::Producer>, Error> {
        let account_claims = Self::candidates_claims(accounts)?;

        Ok(account_claims
            .into_iter()
            .map(|(account, auth)| Producer {
                name: AccountNumber::from(account.as_str()),
                auth,
            })
            .collect())
    }

    fn set_consensus_internal(consensus_data: psibase::ConsensusData) -> Result<(), Error> {
        let set_consensus = Actions::setConsensus {
            prods: consensus_data,
        };

        add_action_to_transaction(Actions::setConsensus::ACTION_NAME, &set_consensus.packed())
    }
}

impl Api for ProducersPlugin {
    fn set_cft_consensus(prods: Vec<String>) -> Result<(), Error> {
        assert!(Client::get_sender() == "config");
        Self::set_consensus_internal(psibase::ConsensusData::CFT(psibase::CftConsensus {
            producers: Self::lookup_candidates(&prods)?,
        }))
    }

    fn set_bft_consensus(prods: Vec<String>) -> Result<(), Error> {
        assert!(Client::get_sender() == "config");
        Self::set_consensus_internal(psibase::ConsensusData::BFT(psibase::BftConsensus {
            producers: Self::lookup_candidates(&prods)?,
        }))
    }

    fn set_producers(prods: Vec<String>) -> Result<(), Error> {
        assert!(Client::get_sender() == "config");
        add_action_to_transaction(
            Actions::setProducers::ACTION_NAME,
            &Actions::setProducers {
                prods: Self::lookup_candidates(&prods)?,
            }
            .packed(),
        )
    }

    fn register_candidate(endpoint: String, claim: ClaimType) -> Result<(), Error> {
        assert!(Client::get_sender() == "config");
        let claim = match claim {
            ClaimType::PubkeyPem(pem) => {
                let spki: SubjectPublicKeyInfo =
                    serde_json::from_value(serde_json::Value::String(pem))
                        .map_err(|e| InvalidResponse(format!("Invalid PEM: {}", e)))?;

                psibase::Claim {
                    service: AccountNumber::from("verify-sig"),
                    rawData: spki.0.into(),
                }
            }
            ClaimType::Generic(claim) => psibase::Claim {
                service: AccountNumber::from(claim.verify_service.as_str()),
                rawData: claim.raw_data.into(),
            },
        };

        add_action_to_transaction(
            Actions::regCandidate::ACTION_NAME,
            &Actions::regCandidate { endpoint, claim }.packed(),
        )
    }

    fn unregister_candidate() {
        assert!(Client::get_sender() == "config");
        add_action_to_transaction(
            Actions::unregCand::ACTION_NAME,
            &Actions::unregCand {}.packed(),
        )
        .unwrap();
    }
}

bindings::export!(ProducersPlugin with_types_in bindings);
