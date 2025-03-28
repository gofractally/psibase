use crate::tables::{
    Attestation, AttestationTable, ConfigTable, Evaluation, EvaluationTable, GroupTable,
};
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

pub fn get_scheduled_phase(evaluation: &Evaluation) -> EvaluationStatus {
    let current_time_seconds = 222;
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
pub fn get_evaluation(id: u32) -> Evaluation {
    let table: EvaluationTable = EvaluationTable::new();
    table.get_index_pk().get(&id).unwrap()
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

pub fn spread_users_into_groups(
    users: &Vec<AccountNumber>,
    group_sizes: Vec<u8>,
) -> Vec<Vec<AccountNumber>> {
    let mut users_to_process = users.clone();
    let mut groups = vec![];

    for group_size in group_sizes {
        let mut group = vec![];
        for _ in 0..group_size {
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

pub fn calculate_results(
    attestations: Vec<Option<Vec<AccountNumber>>>,
    group_size: usize,
) -> GroupResult {
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

pub fn get_group_result(evaluation_id: u32, group_number: u32) -> GroupResult {
    let group_table = GroupTable::new();
    let group = group_table
        .get_index_pk()
        .get(&(evaluation_id, group_number))
        .unwrap();
    let attestation_table: AttestationTable = AttestationTable::new();
    let mut attestations: Vec<Option<Vec<AccountNumber>>> = Vec::new();

    for member in group.members.clone() {
        let attestation = attestation_table
            .get_index_pk()
            .get(&(evaluation_id, member))
            .unwrap();
        attestations.push(attestation.submission);
    }

    calculate_results(attestations, group.members.len())
}
