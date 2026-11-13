use psibase::*;

use crate::batch::{BatchOp, Duration, Precondition, StoredValueOp};
use crate::tables::tables::*;

/// Device-scoped key-value access; routes persistent vs session ops to the right tables.
pub(crate) struct DeviceKv {
    device: Vec<u8>,
}

impl DeviceKv {
    pub(crate) fn new(device: &[u8]) -> Self {
        Self {
            device: device.to_vec(),
        }
    }

    fn device(&self) -> &[u8] {
        &self.device
    }

    pub(crate) fn persistent_value(&self, key: &[u8]) -> Option<Vec<u8>> {
        let now = block_time();
        let value = {
            subjective_tx! {
                DeviceTable::new()
                    .existing_store(self.device())
                    .and_then(|store| KvTable::new().value(&store, key))
            }
        };
        subjective_tx! {
            let _ = DeviceTable::new().touch_store(self.device(), now);
        }
        value
    }

    /// Session id from `existing`, or the next id for this device when `existing` is `None`.
    pub(crate) fn session_id(&self, existing: Option<u32>) -> u32 {
        if let Some(id) = existing {
            return id;
        }
        let now = block_time();
        subjective_tx! {
            DeviceTable::new().allocate_session(self.device(), now)
        }
    }

    pub(crate) fn session_value(&self, session: u32, key: &[u8]) -> Option<Vec<u8>> {
        let now = block_time();
        let value = {
            subjective_tx! {
                DeviceTable::new()
                    .existing_store(self.device())
                    .and_then(|store| SessionKvTable::new().value(&store, session, key))
            }
        };
        subjective_tx! {
            let store = DeviceTable::new().touch_store(self.device(), now);
            if value.is_some() {
                SessionKvTable::new().touch(&store, session, key, now);
            }
        }
        value
    }

    pub(crate) fn apply_batch(
        &self,
        session: Option<u32>,
        ops: Vec<BatchOp>,
    ) -> Result<(), HttpStatus> {
        use Duration::*;
        use StoredValueOp::*;

        let now = block_time();
        let mutated = {
            subjective_tx! {
                let persistent = KvTable::new();
                let sessions = SessionKvTable::new();
                let devices = DeviceTable::new();
                let store = devices.touch_store(self.device(), now);
                let mut mutated = false;
                for op in &ops {
                    if let Precondition::Read(expected) = &op.expected {
                        expected.require_matches(
                            self.current_value(&persistent, &sessions, &store, session, op)
                                .as_deref(),
                        )?;
                    }
                    match (&op.value, op.duration) {
                        (Check, _) => {
                            op.require_read()?;
                            continue;
                        }
                        (Remove, Persistent) => {
                            persistent.erase(&(&store[..], op.key()));
                        }
                        (Remove, Session) => {
                            sessions.erase(&(&store[..], session.unwrap(), op.key()));
                        }
                        (Store(stored), Persistent) => {
                            persistent
                                .put(&KvRow::new(&store, op.key(), &stored.0))
                                .unwrap();
                        }
                        (Store(stored), Session) => {
                            sessions
                                .put(&SessionKvRow::new(
                                    &store,
                                    session.unwrap(),
                                    op.key(),
                                    &stored.0,
                                    now,
                                ))
                                .unwrap();
                        }
                    }
                    mutated = true;
                }
                mutated
            }
        };

        if mutated {
            subjective_tx! {
                let persistent = KvTable::new();
                let sessions = SessionKvTable::new();
                let devices = DeviceTable::new();
                devices.collect_idle(&persistent, now);
                sessions.erase_idle(now);
            }
        }
        Ok(())
    }

    fn current_value(
        &self,
        persistent: &KvTable,
        sessions: &SessionKvTable,
        store: &[u8],
        session: Option<u32>,
        op: &BatchOp,
    ) -> Option<Vec<u8>> {
        match op.duration {
            Duration::Persistent => persistent.value(store, op.key()),
            Duration::Session => {
                session.and_then(|session| sessions.value(store, session, op.key()))
            }
        }
    }
}

fn block_time() -> TimePointSec {
    services::transact::Wrapper::call()
        .currentBlock()
        .time
        .seconds()
}
