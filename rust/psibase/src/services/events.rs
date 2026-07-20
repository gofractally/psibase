use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate as psibase;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Pack, Unpack, ToSchema)]
pub struct EventDb(u8);

#[allow(non_upper_case_globals)]
impl EventDb {
    pub const HistoryEvent: EventDb = EventDb(0);
    pub const MerkleEvent: EventDb = EventDb(1);
}

#[crate::service(name = "events", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::EventDb;
    use crate::{AccountNumber, Checksum256, MethodNumber};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn addIndex(db_id: EventDb, service: AccountNumber, event: MethodNumber, column: u8) {
        unimplemented!()
    }

    /// Writes an event to the event log
    #[action]
    fn event(db: EventDb, type_: MethodNumber, rawData: Vec<u8>) -> u64 {
        unimplemented!()
    }

    #[action]
    fn saveMerkle() -> Checksum256 {
        unimplemented!();
    }

    #[action]
    fn startBlock() {
        unimplemented!()
    }

    #[action]
    fn sync() {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
