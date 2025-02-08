use crate::bindings::host::common as Host;
use crate::bindings::transact::plugin::types::*;
use psibase::{AccountNumber, Hex, Tapos, TimePointSec};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

impl From<Claim> for psibase::Claim {
    fn from(claim: Claim) -> Self {
        psibase::Claim {
            service: AccountNumber::from(claim.verify_service.as_str()),
            rawData: Hex::from(claim.raw_data.clone()),
        }
    }
}

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
        let expiration_time = SystemTime::now() + Duration::from_secs(seconds);
        let expiration = expiration_time
            .duration_since(UNIX_EPOCH)
            .expect("Failed to get time")
            .as_secs();
        assert!(expiration <= i64::MAX as u64, "expiration out of range");
        let expiration_timepoint = TimePointSec::from(expiration as i64);

        let tapos_str =
            Host::server::get_json("/common/tapos/head").expect("[finish_tx] Failed to get TaPoS");
        let partial_tapos: PartialTapos =
            serde_json::from_str(&tapos_str).expect("[finish_tx] Failed to deserialize TaPoS");

        Tapos {
            expiration: expiration_timepoint,
            refBlockSuffix: partial_tapos.refBlockSuffix,
            flags: 0,
            refBlockIndex: partial_tapos.refBlockIndex,
        }
    }
}
