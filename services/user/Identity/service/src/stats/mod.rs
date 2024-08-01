use psibase::{AccountNumber, Table, TimePointSec};

use crate::service::{Attestation, AttestationStats, AttestationStatsTable};

fn is_high_confidence_score(score: u8) -> bool {
    score > 75
}

fn remove_attestation_from_stats(
    stats_rec: &mut AttestationStats,
    existing_attest_rec: Attestation,
) -> &mut AttestationStats {
    if is_high_confidence_score(existing_attest_rec.value) {
        stats_rec.num_high_conf_attestations -= 1;
    }
    stats_rec.unique_attesters -= 1;
    stats_rec
}

fn add_attestation_to_stats(
    stats_rec: &mut AttestationStats,
    subject: AccountNumber,
    value: u8,
    issued: TimePointSec,
) -> &AttestationStats {
    stats_rec.subject = subject;
    stats_rec.most_recent_attestation = issued;
    stats_rec.num_high_conf_attestations += if is_high_confidence_score(value) {
        1
    } else {
        0
    };
    stats_rec.unique_attesters += 1;
    stats_rec
}

/* Keep attestations stats update to date for simpler response to identity-summary queries
if attester-subject pair already in table, recalc %high_conf if necessary based on new score
if attester-subject pair not in table, increment unique attestations and calc new %high_conf score */
pub fn update_attestation_stats(
    existing_attestation: Option<Attestation>,
    subj_acct: AccountNumber,
    value: u8,
    issued: TimePointSec,
) {
    let is_new_unique_attester_for_subj = existing_attestation.is_none();
    let attestation_stats_table = AttestationStatsTable::new();
    let mut stats_rec = attestation_stats_table
        .get_index_pk()
        .get(&(subj_acct))
        .unwrap_or_default();
    // STEPS:
    // 1) ensure the table has a default state (handled by Default impl)
    // 2) if this is a new attestation for an existing subject; remove stat that this entry will replace
    if !is_new_unique_attester_for_subj && stats_rec.unique_attesters > 0 {
        remove_attestation_from_stats(&mut stats_rec, existing_attestation.unwrap());
    }

    // 3) update stats to include this attestation
    add_attestation_to_stats(&mut stats_rec, subj_acct, value, issued);

    let _ = attestation_stats_table
        .put(&stats_rec)
        .map_err(|e| psibase::abort_message(&format!("{}", e)));
}
