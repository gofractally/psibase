use psibase::{AccountNumber, Table, TimePointSec};

use crate::tables::{Attestation, AttestationStats, AttestationStatsTable};

const HIGH_CONF_THRESHOLD: u8 = 75;

fn is_high_confidence_score(score: u8) -> bool {
    score > HIGH_CONF_THRESHOLD
}

fn remove_existing_attestation_from_stats(
    stats_rec: &mut AttestationStats,
    existing_attest_rec: Attestation,
) {
    if is_high_confidence_score(existing_attest_rec.value) {
        stats_rec.numHighConfAttestations -= 1;
    }
    stats_rec.uniqueAttesters -= 1;
}

fn add_attestation_to_stats(
    stats_rec: &mut AttestationStats,
    subject: AccountNumber,
    value: u8,
    issued: TimePointSec,
) {
    stats_rec.subject = subject;
    stats_rec.mostRecentAttestation = issued;
    stats_rec.numHighConfAttestations += if is_high_confidence_score(value) {
        1
    } else {
        0
    };
    stats_rec.uniqueAttesters += 1;
}

/* Keep attestations stats up-to-date to minimize cpu need for identity-summary queries
if attester-subject pair already in table, recalc uniqueAttesters and highConfScores if necessary based on new score
if attester-subject pair not in table, increment unique attestations and calc new %high_conf score */
pub fn update_attestation_stats(
    existing_attestation: Option<Attestation>,
    subj_acct: AccountNumber,
    value: u8,
    issued: TimePointSec,
) {
    let is_new_unique_attester_for_subj = existing_attestation.is_none();
    let attestation_stats_table = AttestationStatsTable::new();
    // 1) ensure the table has a default state (handled by unwrap_or() above)
    let mut stats_rec = attestation_stats_table
        .get_index_pk()
        .get(&(subj_acct))
        .unwrap_or(AttestationStats {
            subject: AccountNumber::from(0),
            numHighConfAttestations: 0,
            uniqueAttesters: 0,
            mostRecentAttestation: TimePointSec::from(0),
        });
    // 2) if this is a new attestation for an existing subject; remove stat that this entry will replace
    if !is_new_unique_attester_for_subj && stats_rec.uniqueAttesters > 0 {
        remove_existing_attestation_from_stats(&mut stats_rec, existing_attestation.unwrap());
    }

    // 3) update stats to include latest attestation
    add_attestation_to_stats(&mut stats_rec, subj_acct, value, issued);

    attestation_stats_table.put(&stats_rec).unwrap();
}
