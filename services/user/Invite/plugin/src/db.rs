use crate::*;

use clientdata::plugin::keyvalue as clientdata;
use psibase::fracpack::{Pack, Unpack};
use types::InviteRecordSubset;

pub struct InvitesTable {}
impl InvitesTable {
    pub fn add_invite(id: u32, invite: &InviteRecordSubset) {
        clientdata::set(&id.to_string(), &invite.packed()).unwrap();
    }

    pub fn get_invite(id: u32) -> Option<InviteRecordSubset> {
        clientdata::get(&id.to_string()).map(|data| InviteRecordSubset::unpacked(&data).unwrap())
    }

    pub fn delete_invite(id: u32) {
        clientdata::delete(&id.to_string());
    }
}
