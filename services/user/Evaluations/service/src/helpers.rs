use crate::db::tables::{ConfigTable, Evaluation, EvaluationTable, User, UserTable};
use psibase::AccountNumber;
use psibase::*;
use std::collections::HashMap;

#[derive(PartialEq, Eq)]
pub enum EvaluationStatus {
    Pending,
    Registration,
    Deliberation,
    Submission,
    Closed,
}

#[derive(Eq, PartialEq)]
pub enum GroupResult {
    InsufficientAttestations, // Still waiting for more attestations to call
    ConsensusMisalignment, // Attestations are not in consensus, awaiting more attestations to call
    IrreconcilableFailure, // Attestations are not in consensus and cannot be reconciled
    ConsensusSuccess(Vec<AccountNumber>), // Attestations are in consensus
}

pub fn get_current_time_seconds() -> u32 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .seconds()
        .seconds as u32
}

pub fn get_scheduled_phase(evaluation: &Evaluation) -> EvaluationStatus {
    let current_time_seconds = get_current_time_seconds();
    calculate_scheduled_phase(evaluation, current_time_seconds)
}

pub fn calculate_scheduled_phase(
    evaluation: &Evaluation,
    current_time_seconds: u32,
) -> EvaluationStatus {
    if current_time_seconds >= evaluation.finish_by {
        EvaluationStatus::Closed
    } else if current_time_seconds >= evaluation.submission_starts {
        EvaluationStatus::Submission
    } else if current_time_seconds >= evaluation.deliberation_starts {
        EvaluationStatus::Deliberation
    } else if current_time_seconds >= evaluation.registration_starts {
        EvaluationStatus::Registration
    } else {
        EvaluationStatus::Pending
    }
}

pub fn assert_status(evaluation: &Evaluation, expected_status: EvaluationStatus) {
    let current_phase = get_scheduled_phase(&evaluation);
    let phase_name = match current_phase {
        EvaluationStatus::Pending => "Pending",
        EvaluationStatus::Registration => "Registration",
        EvaluationStatus::Deliberation => "Deliberation",
        EvaluationStatus::Submission => "Submission",
        EvaluationStatus::Closed => "Closed",
    };
    check(
        current_phase == expected_status,
        format!("evaluation must be in {phase_name} phase").as_str(),
    );
}

pub fn update_evaluation(evaluation: &Evaluation) {
    let table: EvaluationTable = EvaluationTable::new();
    table.put(evaluation).unwrap();
}

pub fn get_next_id() -> u32 {
    let table = ConfigTable::new();
    let mut config = table.get_index_pk().get(&SingletonKey {}).unwrap();
    config.last_used_id += 1;
    table.put(&config).unwrap();
    config.last_used_id
}

pub fn shuffle_vec<T>(vec: &mut Vec<T>, seed: u64) {
    let len = vec.len();
    if len <= 1 {
        return;
    }

    let mut rng = seed;
    fn next_rand(current: u64) -> u64 {
        current
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407)
    }

    for i in (1..len).rev() {
        rng = next_rand(rng);
        let j = (rng as usize) % (i + 1);
        vec.swap(i, j);
    }
}

pub fn chunk_users(users: &Vec<User>, chunk_sizes: Vec<u8>) -> Vec<Vec<User>> {
    let mut users_to_process = users.clone();
    let mut groups = vec![];

    for chunk_size in chunk_sizes {
        let mut group = vec![];
        for _ in 0..chunk_size {
            let user = users_to_process.pop();
            if let Some(user) = user {
                group.push(user);
            }
        }
        if group.len() > 0 {
            groups.push(group);
        }
    }
    groups
}

pub fn spread_users(
    users_to_process: &Vec<User>,
    evaluation: &Evaluation,
) -> Option<Vec<Vec<User>>> {
    let chunk_sizes = psibase::services::subgroups::Wrapper::call().gmp(
        users_to_process.len() as u32,
        evaluation
            .allowable_group_sizes
            .iter()
            .map(|&size| size as u32)
            .collect(),
    )?;

    Some(chunk_users(
        users_to_process,
        chunk_sizes.into_iter().map(|size| size as u8).collect(),
    ))
}

pub fn calculate_results(attestations: Vec<Option<Vec<AccountNumber>>>) -> GroupResult {
    let group_size = attestations.len();
    let minimum_required_to_call = (group_size as f32 * 0.51).ceil() as usize;
    let flat_attestations: Vec<_> = attestations.into_iter().flatten().collect();
    let total_possible_attestations = group_size;
    let attestations_received = flat_attestations.len();

    if attestations_received < minimum_required_to_call {
        return GroupResult::InsufficientAttestations;
    }

    let mut counts = HashMap::new();
    for att in flat_attestations {
        *counts.entry(att).or_insert(0) += 1;
    }

    if let Some((att, _)) = counts
        .iter()
        .find(|(_, &count)| count >= minimum_required_to_call)
    {
        return GroupResult::ConsensusSuccess(att.clone());
    }

    let remaining_possible_attestations = total_possible_attestations - attestations_received;
    let max_count = counts.values().max().unwrap_or(&0);
    if *max_count + remaining_possible_attestations < minimum_required_to_call {
        return GroupResult::IrreconcilableFailure;
    }

    GroupResult::ConsensusMisalignment
}

pub fn get_user(evaluation_id: u32, user: AccountNumber) -> User {
    let table = UserTable::new();
    table.get_index_pk().get(&(evaluation_id, user)).unwrap()
}

pub fn get_group_result(evaluation_id: u32, group_number: u32) -> GroupResult {
    let users = Evaluation::get(evaluation_id).get_users();
    let attestations = users
        .iter()
        .filter(|user| user.group_number == Some(group_number))
        .map(|user| user.submission.clone())
        .collect();
    calculate_results(attestations)
}
