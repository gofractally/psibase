#[allow(warnings)]
mod bindings;
use bindings::*;

use auth_sig::plugin::keyvault::to_der;
use host::common::types::Error;
use transact::plugin::intf::add_action_to_transaction;

use exports::producers::plugin::api::Guest as Api;
use producers::plugin::types::*;

use psibase::fracpack::Pack;
use psibase::services;
use psibase::AccountNumber;
use services::producers::action_structs as Actions;

struct ProducersPlugin;

impl From<Producer> for psibase::Producer {
    fn from(value: Producer) -> Self {
        let auth_claim = match value.auth_claim {
            ClaimType::PubkeyPem(pem) => {
                let der = to_der(&pem).unwrap();
                psibase::Claim {
                    service: AccountNumber::from("verify-sig"),
                    rawData: der.into(),
                }
            }
            ClaimType::Generic(claim) => psibase::Claim {
                service: AccountNumber::from(claim.verify_service.as_str()),
                rawData: claim.raw_data.into(),
            },
        };

        psibase::Producer {
            name: AccountNumber::from(value.name.as_str()),
            auth: auth_claim,
        }
    }
}

struct ProducerVec(Vec<Producer>);
impl From<ProducerVec> for Vec<psibase::Producer> {
    fn from(value: ProducerVec) -> Self {
        value.0.into_iter().map(|p| p.into()).collect()
    }
}

impl ProducersPlugin {
    fn set_consensus_internal(consensus_data: psibase::ConsensusData) -> Result<(), Error> {
        let set_consensus = Actions::setConsensus {
            prods: consensus_data,
        };

        staged_tx::plugin::proposer::set_propose_latch(Some(
            &services::producers::SERVICE.to_string(),
        ))?;

        add_action_to_transaction(Actions::setConsensus::ACTION_NAME, &set_consensus.packed())
    }
}

impl Api for ProducersPlugin {
    fn set_cft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let producers: Vec<psibase::Producer> = ProducerVec(prods).into();
        Self::set_consensus_internal(psibase::ConsensusData::CFT(psibase::CftConsensus {
            producers,
        }))
    }

    fn set_bft_consensus(prods: Vec<Producer>) -> Result<(), Error> {
        let producers: Vec<psibase::Producer> = ProducerVec(prods).into();
        Self::set_consensus_internal(psibase::ConsensusData::BFT(psibase::BftConsensus {
            producers,
        }))
    }

    fn set_producers(prods: Vec<Producer>) -> Result<(), Error> {
        let producers: Vec<psibase::Producer> = ProducerVec(prods).into();

        let set_prods = Actions::setProducers { prods: producers };

        staged_tx::plugin::proposer::set_propose_latch(Some(
            &services::producers::SERVICE.to_string(),
        ))?;

        add_action_to_transaction(Actions::setConsensus::ACTION_NAME, &set_prods.packed())
    }
}

bindings::export!(ProducersPlugin with_types_in bindings);
