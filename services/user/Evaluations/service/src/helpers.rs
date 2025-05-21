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
    InsufficientAttestations,  // Still waiting for more attestations to call
    ConsensusMisalignment, // Attestations are not in consensus, awaiting more attestations to call
    IrreconcilableFailure, // Attestations are not in consensus and cannot be reconciled
    ConsensusSuccess(Vec<u8>), // Attestations are in consensus
}

pub fn get_current_time_seconds() -> u32 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .seconds()
        .seconds as u32
}

pub fn calculate_results(attestations: Vec<Option<Vec<u8>>>) -> GroupResult {
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
