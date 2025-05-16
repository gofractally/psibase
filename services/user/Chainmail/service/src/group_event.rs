use psibase::{Fracpack, ToSchema};

#[derive(Debug, Copy, Clone, Fracpack, ToSchema)]
pub struct GroupEvent {
    pub ty: u8,
}

impl GroupEvent {
    pub const CREATED: u8 = 0;
    pub const KEY_ROTATED: u8 = 1;
    pub const DELETED: u8 = 2;
}

impl ToString for GroupEvent {
    fn to_string(&self) -> String {
        match self.ty {
            GroupEvent::CREATED => "created".to_string(),
            GroupEvent::DELETED => "deleted".to_string(),
            GroupEvent::KEY_ROTATED => "key rotated".to_string(),
            _ => "unknown".to_string(),
        }
    }
}

impl From<u8> for GroupEvent {
    fn from(value: u8) -> Self {
        psibase::check(value <= 2, "Invalid group event type");
        GroupEvent { ty: value }
    }
}
