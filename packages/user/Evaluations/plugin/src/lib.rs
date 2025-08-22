#[allow(warnings)]
mod bindings;

use bindings::exports::evaluations::plugin::admin::Guest as Admin;
use bindings::exports::evaluations::plugin::user::Guest as User;
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::{fracpack::Pack, ActionMeta};

pub mod consensus;
mod errors;
mod graphql;
pub mod helpers;
mod key_table;
pub mod types;

use errors::ErrorType;
use evaluations::action_structs as Actions;
use helpers::{
    check_app_origin, current_user, get_decrypted_proposals, get_symmetric_key,
    parse_account_number,
};
use std::collections::HashSet;

struct EvaluationsPlugin;

impl Admin for EvaluationsPlugin {
    fn create(
        registration: u32,
        deliberation: u32,
        submission: u32,
        finish_by: u32,
        allowed_group_sizes: Vec<u8>,
        num_options: u8,
        use_hooks: bool,
    ) -> Result<(), Error> {
        let packed_args = Actions::create {
            registration,
            deliberation,
            submission,
            finish_by,
            allowed_group_sizes,
            num_options,
            use_hooks,
        }
        .packed();
        add_action_to_transaction(Actions::create::ACTION_NAME, &packed_args)
    }

    fn start(evaluation_id: u32) -> Result<(), Error> {
        let packed_args = Actions::start { evaluation_id }.packed();
        add_action_to_transaction(Actions::start::ACTION_NAME, &packed_args)
    }

    fn close(evaluation_owner: String, evaluation_id: u32) -> Result<(), Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;

        let packed_args = Actions::close {
            evaluation_id,
            owner: evaluation_owner,
        }
        .packed();
        add_action_to_transaction(Actions::close::ACTION_NAME, &packed_args)
    }

    fn delete(evaluation_id: u32, force: bool) -> Result<(), Error> {
        let packed_args = Actions::delete {
            evaluation_id,
            force,
        }
        .packed();

        add_action_to_transaction(Actions::delete::ACTION_NAME, &packed_args)
    }

    fn register_other(evaluation_id: u32, registrant: String) -> Result<(), Error> {
        let registrant = parse_account_number(&registrant)?;

        let packed_args = Actions::register {
            owner: current_user()?,
            evaluation_id,
            registrant,
        }
        .packed();
        add_action_to_transaction(Actions::register::ACTION_NAME, &packed_args)
    }

    fn unregister_other(evaluation_id: u32, registrant: String) -> Result<(), Error> {
        let registrant = parse_account_number(&registrant)?;

        let packed_args = Actions::unregister {
            owner: current_user()?,
            evaluation_id,
            registrant,
        }
        .packed();
        add_action_to_transaction(Actions::unregister::ACTION_NAME, &packed_args)
    }
}

impl User for EvaluationsPlugin {
    fn register(evaluation_owner: String, evaluation_id: u32) -> Result<(), Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;

        check_app_origin(evaluation_owner)?;

        let key = key_table::AsymKey::new();
        let public_key_vectored = key.public_key()?.serialize().to_vec();

        let packed_args = Actions::set_key {
            key: public_key_vectored,
        }
        .packed();
        add_action_to_transaction(Actions::set_key::ACTION_NAME, &packed_args)
            .map_err(|e| ErrorType::TransactionFailed(e.to_string()))?;
        key.save()?;

        let registrant = current_user().expect("not authenticated");

        let packed_args = Actions::register {
            owner: evaluation_owner,
            evaluation_id,
            registrant,
        }
        .packed();
        add_action_to_transaction(Actions::register::ACTION_NAME, &packed_args)
    }

    fn unregister(evaluation_owner: String, evaluation_id: u32) -> Result<(), Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;
        check_app_origin(evaluation_owner)?;

        let registrant = current_user().expect("not authenticated");

        let packed_args = Actions::unregister {
            owner: evaluation_owner,
            evaluation_id,
            registrant,
        }
        .packed();
        add_action_to_transaction(Actions::unregister::ACTION_NAME, &packed_args)
    }

    fn propose(
        evaluation_owner: String,
        evaluation_id: u32,
        group_number: u32,
        proposal: Vec<String>,
    ) -> Result<(), Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;
        check_app_origin(evaluation_owner)?;

        let current_user = current_user()?;

        let symmetric_key =
            get_symmetric_key(evaluation_owner, evaluation_id, group_number, current_user)?;

        let parsed_proposal = proposal
            .iter()
            .map(|p| {
                p.parse::<u8>()
                    .map_err(|_| ErrorType::InvalidProposal.into())
            })
            .collect::<Result<Vec<u8>, Error>>()?;

        let encrypted_proposal = bindings::aes::plugin::with_password::encrypt(
            &symmetric_key.key,
            &parsed_proposal,
            symmetric_key.salt_base_64().as_str(),
        );

        let packed_args = Actions::propose {
            owner: evaluation_owner,
            evaluation_id,
            proposal: encrypted_proposal,
        }
        .packed();

        add_action_to_transaction(Actions::propose::ACTION_NAME, &packed_args)
    }

    fn attest(
        evaluation_owner: String,
        evaluation_id: u32,
        group_number: u32,
    ) -> Result<(), Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;
        let current_user = current_user()?;
        check_app_origin(evaluation_owner)?;

        let eval_data = graphql::fetch_and_decode(evaluation_owner, evaluation_id, group_number)?;
        // TODO: Don't fetch_and_decode again inside get_decrypted_proposals, just call e.g. `decrypt(proposals)`

        let mut submissions =
            get_decrypted_proposals(evaluation_owner, evaluation_id, group_number, current_user)?;

        fractal_proposal_rules::prepare_submissions(
            &mut submissions,
            eval_data
                .get_group_users
                .expect("No group users found")
                .nodes
                .len(),
        );

        let mut proposals = submissions
            .into_iter()
            .filter_map(|(_, submission)| submission)
            .collect::<Vec<Vec<u8>>>();

        assert!(proposals.len() > 0, "No proposals found");

        // Verify that no elements are repeated in each proposal
        for proposal in proposals.iter() {
            let mut unique_elements = HashSet::new();
            for element in proposal {
                if !unique_elements.insert(element) {
                    return Err(ErrorType::DuplicateElement.into());
                }
            }
        }

        let consensus = consensus::alignment_merge(&mut proposals).expect("Alignment merge failed");

        let packed_args = Actions::attest {
            owner: evaluation_owner,
            evaluation_id,
            attestation: consensus,
        }
        .packed();
        add_action_to_transaction(Actions::attest::ACTION_NAME, &packed_args)
    }

    fn get_proposal(
        evaluation_owner: String,
        evaluation_id: u32,
        group_number: u32,
    ) -> Result<Option<Vec<u8>>, Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;

        check_app_origin(evaluation_owner)?;
        let current_user = current_user()?;
        let submissions =
            get_decrypted_proposals(evaluation_owner, evaluation_id, group_number, current_user)?;

        let user_submission = submissions
            .into_iter()
            .find(|(account, _)| account.value == current_user.value)
            .ok_or(ErrorType::UserSubmissionNotFound)?;

        Ok(user_submission.1)
    }

    fn get_group_users(
        evaluation_owner: String,
        evaluation_id: u32,
        group_number: u32,
    ) -> Result<Vec<String>, Error> {
        let evaluation_owner = parse_account_number(&evaluation_owner)?;
        let users = graphql::fetch_group_users(evaluation_owner, evaluation_id, group_number)?
            .get_group_users
            .nodes;

        Ok(users.into_iter().map(|user| user.user).collect())
    }
}

// TODO: These rules will be moved to the fractals plugin, as they are not general evaluation constraints
// The `attest` evaluations plugin function will eventually take the attestation directly as an argument
mod fractal_proposal_rules {
    use psibase::AccountNumber;
    use std::collections::HashSet;
    use std::hash::Hash;

    /// Preparing the submissions for an attestation.
    ///
    /// Main preparations:
    /// 1. Remove any empty proposals
    /// 2. Remove any proposals that include their own account's index
    /// 3. Prune outliers from proposals, where an outlier is an element that is not present in at least 2/3rds of the proposals
    ///
    /// Also asserts that there are enough proposals to submit a fractal evaluation proposal.
    /// In fractal evaluations, it is required that >= 2/3rds of the group has
    ///   submitted a proposal in order for attestations to be considered valid.
    ///
    /// Parameters:
    /// * `submissions`: The submissions to the evaluation.
    /// * `group_size`: The size of the group.
    pub fn prepare_submissions(
        submissions: &mut Vec<(AccountNumber, Option<Vec<u8>>)>,
        group_size: usize,
    ) {
        // Remove empty proposals
        submissions.retain(|s| s.1.is_some());

        // Remove accounts from their own proposals, if they included it in their proposal
        for (index, (account, proposal)) in submissions.iter_mut().enumerate() {
            if let Some(proposal) = proposal {
                if proposal.contains(&(index as u8)) {
                    println!("Removing {} from their own proposal", &account.to_string());
                    proposal.retain(|&x| x != index as u8);
                }
            }
        }

        // Extract proposals for pruning
        let mut proposals: Vec<Vec<u8>> = submissions
            .iter()
            .filter_map(|(_, proposal)| proposal.clone())
            .collect();
        // Prune outliers from proposals
        prune_outliers(&mut proposals);
        // Update submissions with pruned proposals
        for (submission, proposal) in submissions.iter_mut().zip(proposals.into_iter()) {
            if let Some(submission_proposal) = submission.1.as_mut() {
                *submission_proposal = proposal;
            }
        }

        // Remove fully pruned proposals
        submissions.retain(|s| s.1.iter().len() > 0);

        // Assert that there are enough proposals to submit a fractal evaluation proposal
        let threshold = (group_size * 2 + 2) / 3; // Ceiling of (2/3)*group_size
        assert!(
            submissions.len() >= threshold,
            "Not enough proposals for attestation"
        );
    }

    /// Prunes outlier elements
    ///
    /// An element is an outlier if it is represented in fewer than a threshold number of input lists.
    /// In the case of the fractal evaluations, an element must be represented in >= 2/3rds of proposals
    ///
    /// Parameters:
    /// * `lists`: The input lists.
    ///
    /// Returns:
    /// * A vector of lists with the outliers removed.
    fn prune_outliers<T: PartialEq + Copy + Eq + Hash>(proposals: &mut Vec<Vec<T>>) {
        // Nothing is an outlier if there are only two proposals
        if proposals.len() <= 2 {
            return;
        }

        let outlier_threshold = (proposals.len() * 2 / 3) - 1;
        let unique_set: HashSet<T> = proposals.iter().flatten().copied().collect();

        let mut eliminated_options: Vec<T> = Vec::new();

        unique_set.iter().for_each(|element| {
            let count = proposals
                .iter()
                .filter(|&list| list.contains(element))
                .count();
            if count <= outlier_threshold {
                eliminated_options.push(*element);
            }
        });

        for list in proposals.iter_mut() {
            list.retain(|o| !eliminated_options.contains(o));
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{prepare_submissions, prune_outliers};
        use psibase::account;

        fn run_prune_outliers(lists: &mut Vec<Vec<u8>>) {
            println!("Pruning: {:?}", lists);
            prune_outliers(lists);
            println!("Result:  {:?}", lists);
        }

        #[test]
        fn test_prune() {
            let l1 = || vec![1, 2, 3, 4, 5];
            let l2 = || vec![1, 2, 3, 4, 5, 6];
            let mut list = vec![l1(), l1(), l2()];

            run_prune_outliers(&mut list);

            assert_eq!(list, vec![l1(), l1(), l1()]);
        }

        #[test]
        #[should_panic(expected = "Not enough proposals for attestation")]
        fn test_prepare_submissions_insufficient() {
            // Test that submissions below 2/3 threshold cause a panic
            let mut submissions = vec![
                (account!("alice"), Some(vec![2, 3, 4])), // b, c, d
                (account!("bob"), Some(vec![1, 3, 4])),   // a, c, d
                (account!("carol"), None),
                (account!("dan"), None),
            ];
            let group_size = 4;
            prepare_submissions(&mut submissions, group_size);
        }

        #[test]
        fn test_prepare_submissions_self_reference() {
            // Test that self-references are removed
            let mut submissions = vec![
                (account!("alice"), Some(vec![0, 1, 2, 3])), // 0 is alice's index
                (account!("bob"), Some(vec![0, 1, 2, 3])),   // 1 is bob's index
                (account!("carol"), Some(vec![0, 1, 2, 3])), // 2 is carol's index
                (account!("dan"), Some(vec![0, 1, 2, 3])),   // 3 is dan's index
            ];
            let group_size = 3;
            prepare_submissions(&mut submissions, group_size);

            // Each submission should contain all indices except its own
            submissions
                .iter()
                .enumerate()
                .for_each(|(i, (_, proposal))| {
                    let expected: Vec<u8> = (0..4).filter(|&j| j != i as u8).collect();
                    assert_eq!(
                        proposal.as_ref().unwrap(),
                        &expected,
                        "Self-reference should be removed"
                    );
                });
        }
    }
}

bindings::export!(EvaluationsPlugin with_types_in bindings);
