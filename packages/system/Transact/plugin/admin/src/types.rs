use crate::bindings::host::http as Host;
use psibase::{Tapos, TimePointSec};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct PartialTapos {
    refBlockIndex: u8,
    refBlockSuffix: u32,
}

pub trait FromExpirationTime {
    fn from_expiration_time(expiration_time: u64) -> Self;
}

impl FromExpirationTime for Tapos {
    fn from_expiration_time(seconds: u64) -> Self {
        let tapos_str =
            Host::api::get_json("/common/tapos/head").expect("[finish_tx] Failed to get TaPoS");

        let partial_tapos: PartialTapos =
            serde_json::from_str(&tapos_str).expect("[finish_tx] Failed to deserialize TaPoS");

        let expiration_time = SystemTime::now() + Duration::from_secs(seconds);
        let expiration = expiration_time
            .duration_since(UNIX_EPOCH)
            .expect("Failed to get time")
            .as_secs();
        assert!(expiration <= i64::MAX as u64, "expiration out of range");
        let expiration_timepoint = TimePointSec::from(expiration as i64);

        Tapos {
            expiration: expiration_timepoint,
            refBlockSuffix: partial_tapos.refBlockSuffix,
            flags: 0,
            refBlockIndex: partial_tapos.refBlockIndex,
        }
    }
}
