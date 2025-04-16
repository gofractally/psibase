#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::evaluations::plugin::api::Guest as Api;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

pub mod consensus;
mod errors;
mod graphql;
pub mod helpers;
mod key_table;
pub mod types;

use graphql::fetch_and_decode;
use helpers::{current_user, get_decrypted_proposals, get_symmetric_key};

struct EvaluationsPlugin;

impl Api for EvaluationsPlugin {
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        group_sizes: Vec<String>,
        rank_amount: u8,
        use_hooks: bool,
    ) -> Result<(), Error> {
        let sizes = group_sizes
            .iter()
            .map(|s| s.parse::<u8>().unwrap())
            .collect();

        let packed_args = evaluations::action_structs::create {
            registration,
            deliberation,
            submission,
            finish_by,
            group_sizes: sizes,
            rank_amount,
            use_hooks,
        }
        .packed();
        add_action_to_transaction("create", &packed_args)
    }

    fn register(id: u32, account: String) -> Result<(), Error> {
        let key = key_table::AsymKey::new();
        let public_key_vectored = key.public_key().serialize().to_vec();

        let packed_args = evaluations::action_structs::setKey {
            key: public_key_vectored,
        }
        .packed();
        add_action_to_transaction("setKey", &packed_args).unwrap();
        key.save()?;

        let account_number = psibase::AccountNumber::from_str(account.as_str()).unwrap();
        let packed_args = evaluations::action_structs::register { id, account_number }.packed();
        add_action_to_transaction("register", &packed_args)
    }

    fn unregister(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::unregister { id }.packed();
        add_action_to_transaction("unregister", &packed_args)
    }

    fn start(id: u32, entropy: u64) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::start { id, entropy }.packed();
        add_action_to_transaction("start", &packed_args)
    }

    fn close(id: u32) -> Result<(), Error> {
        let packed_args = evaluations::action_structs::close { id }.packed();
        add_action_to_transaction("close", &packed_args)
    }

    fn attest(evaluation_id: u32, group_number: u32) -> Result<(), Error> {
        let current_user = current_user()?;
        let submissions = get_decrypted_proposals(evaluation_id, group_number, current_user)?;

        let evaluation = fetch_and_decode(evaluation_id, group_number)?;
        let consensus = consensus::calculate_consensus(
            submissions
                .into_iter()
                .map(|(_, submission)| submission)
                .collect(),
            evaluation.getEvaluation.unwrap().rankAmount,
            group_number,
        );

        let packed_args = evaluations::action_structs::attest {
            evaluation_id,
            attestation: consensus,
        }
        .packed();
        add_action_to_transaction("attest", &packed_args)
    }

    fn get_proposal(evaluation_id: u32, group_number: u32) -> Result<Option<Vec<u8>>, Error> {
        let current_user = current_user()?;
        let submissions = get_decrypted_proposals(evaluation_id, group_number, current_user)?;

        let user_submission = submissions
            .into_iter()
            .find(|(account, _)| account.value == current_user.value)
            .expect("user submission is not found");

        Ok(user_submission.1)
    }

    fn propose(evaluation_id: u32, group_number: u32, proposal: Vec<String>) -> Result<(), Error> {
        let current_user = current_user()?;
        let symmetric_key = get_symmetric_key(evaluation_id, group_number, current_user)?;

        let parsed_proposal = proposal
            .iter()
            .map(|p| p.parse::<u8>().unwrap())
            .collect::<Vec<u8>>();

        let encrypted_proposal = bindings::aes::plugin::with_password::encrypt(
            &symmetric_key.key,
            &parsed_proposal,
            symmetric_key.salt_base_64().as_str(),
        );

        let packed_args = evaluations::action_structs::propose {
            evaluation_id,
            proposal: encrypted_proposal,
        }
        .packed();

        add_action_to_transaction("propose", &packed_args)
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
