use psibase::{AccountNumber, Table, TimePointSec};

use crate::service::{AttestationStats, AttestationStatsTable};

fn get_num_high_conf_attestations(perc_high_conf: u8, unique_attesters: u16) -> f32 {
    perc_high_conf as f32 / 100.0 * unique_attesters as f32
}

fn get_perc_high_conf(num_high_conf_attestations: f32, num_unique_attesters: f32) -> u8 {
    (num_high_conf_attestations / num_unique_attesters * 100.0).round() as u8
}

fn remove_attestation_from_stats(stats_rec: &mut AttestationStats) -> &mut AttestationStats {
    // REMINDER: I broke the math here when I used u16 to truncate; perhaps I just wipe the chain instead of fix data in table with code... or just create new accounts to work with clean attestatations
    let num_high_conf =
        get_num_high_conf_attestations(stats_rec.perc_high_conf, stats_rec.unique_attesters);
    stats_rec.unique_attesters -= 1;
    stats_rec.perc_high_conf = if stats_rec.unique_attesters == 0 {
        0
    } else {
        println!(
            "num_high_conf: {}, unique_attesters: {} = new % high conf: {}",
            num_high_conf,
            stats_rec.unique_attesters,
            get_perc_high_conf(num_high_conf, stats_rec.unique_attesters as f32)
        );
        get_perc_high_conf(num_high_conf, stats_rec.unique_attesters as f32)
    };
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
    println!("value: {}", value);
    let num_existing_high_conf_attestations =
        get_num_high_conf_attestations(stats_rec.perc_high_conf, stats_rec.unique_attesters);
    stats_rec.perc_high_conf = get_perc_high_conf(
        num_existing_high_conf_attestations + if value > 75 { 1.0 } else { 0.0 },
        stats_rec.unique_attesters as f32 + 1.0,
    );
    stats_rec.unique_attesters += 1;
    stats_rec
}

pub fn update_attestation_stats(
    subj_acct: AccountNumber,
    is_new_unique_attester_for_subj: bool,
    value: u8,
    issued: TimePointSec,
) {
    let attestation_stats_table = AttestationStatsTable::new();
    let mut stats_rec = attestation_stats_table
        .get_index_pk()
        .get(&(subj_acct))
        .unwrap_or_default();
    println!("at start:\n{}", stats_rec);
    // STEPS:
    // 1) ensure the table has a default state (do this as an impl on the table)
    //  -- This is handled by Default impl
    // 2) if this is a new attestation for an existing subject; remove stat that this entry will replace
    println!(
        "is_unique: {}, # unique: {}",
        is_new_unique_attester_for_subj, stats_rec.unique_attesters
    );
    if !is_new_unique_attester_for_subj && stats_rec.unique_attesters > 0 {
        println!("have records; is not unique; removing attestation from stats...");
        remove_attestation_from_stats(&mut stats_rec);
        println!("after removing existing:\n{}", stats_rec);
    }

    // 3) update stats to include this attestation
    add_attestation_to_stats(&mut stats_rec, subj_acct, value, issued);

    println!("new % conf: {}", stats_rec.perc_high_conf);
    println!("after:\n{}", stats_rec);

    let _ = attestation_stats_table
        .put(&stats_rec)
        .map_err(|e| psibase::abort_message(&format!("{}", e)));
}
