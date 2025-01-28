use psibase::{Fracpack, ToSchema};

#[derive(Debug, Copy, Clone, Fracpack, ToSchema)]
pub struct StagedTxEvent {
    pub ty: u8,
}

impl StagedTxEvent {
    pub const PROPOSED: u8 = 0;
    pub const ACCEPTED: u8 = 1;
    pub const REJECTED: u8 = 2;
    pub const DELETED: u8 = 3;
    pub const EXECUTED: u8 = 4;
}

impl ToString for StagedTxEvent {
    fn to_string(&self) -> String {
        match self.ty {
            StagedTxEvent::PROPOSED => "proposed".to_string(),
            StagedTxEvent::ACCEPTED => "accepted".to_string(),
            StagedTxEvent::REJECTED => "rejected".to_string(),
            StagedTxEvent::DELETED => "deleted".to_string(),
            StagedTxEvent::EXECUTED => "executed".to_string(),
            _ => "unknown".to_string(),
        }
    }
}

impl From<u8> for StagedTxEvent {
    fn from(value: u8) -> Self {
        psibase::check(value <= 4, "Invalid staged tx event type");
        StagedTxEvent { ty: value }
    }
}
