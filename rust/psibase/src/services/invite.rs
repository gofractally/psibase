use crate::{AccountNumber, PublicKey};
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "InviteRecordInput")]
pub struct InviteRecord {
    pubkey: PublicKey,
    inviter: AccountNumber,
    actor: AccountNumber,
    expiry: u32,
    newAccountToken: bool,
    state: u8,
}

#[derive(Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "NewAccountRecordInput")]
pub struct NewAccountRecord {
    name: AccountNumber,
    invitee: AccountNumber,
}

#[crate::service(name = "invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, AccountNumber, Hex, PublicKey};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn createInvite(inviteKey: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn accept(inviteKey: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn acceptCreate(inviteKey: PublicKey, acceptedBy: AccountNumber, newAccountKey: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn reject(inviteKey: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn delInvite(inviteKey: PublicKey) {
        unimplemented!()
    }

    #[action]
    fn delExpired(maxDeleted: u32) {
        unimplemented!()
    }

    // Admin functions
    #[action]
    fn setWhitelist(accounts: Vec<AccountNumber>) {
        unimplemented!()
    }
    #[action]
    fn setBlacklist(accounts: Vec<AccountNumber>) {
        unimplemented!()
    }

    // For synchronous calls between services:
    #[action]
    fn getInvite(pubkey: PublicKey) -> Option<super::InviteRecord> {
        unimplemented!()
    }
    #[action]
    fn isExpired(pubkey: PublicKey) -> bool {
        unimplemented!()
    }
    #[action]
    fn checkClaim(actor: AccountNumber, pubkey: PublicKey) {
        unimplemented!()
    }
}
