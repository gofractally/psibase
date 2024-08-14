use crate::services::auth_sig::Spki;
use crate::AccountNumber;
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject, ToSchema,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "InviteRecordInput")]


/// An invite object
pub struct InviteRecord {
    /// The public key of the invite. This uniquely identifies an invite and 
    ///   may also used to authenticate the transaction accepting the invite.
    pubkey: Spki,

    /// The creator of the invite object
    inviter: AccountNumber,

    /// The last account to accept or reject the invite
    actor: AccountNumber,

    /// The time in seconds at which this invite expires
    expiry: u32,

    /// A flag that represents whether a new account may still be created by 
    ///   redeeming this invite
    newAccountToken: bool,

    /// An integer representing whether the invite is:
    ///  - pending (0)
    ///  - accepted (1)
    ///  - rejected (2)
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
    use crate::services::auth_sig::Spki;
    use crate::{http::HttpRequest, AccountNumber, Hex};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn createInvite(inviteKey: Spki) {
        unimplemented!()
    }

    #[action]
    fn accept(inviteKey: Spki) {
        unimplemented!()
    }

    #[action]
    fn acceptCreate(inviteKey: Spki, acceptedBy: AccountNumber, newAccountKey: Spki) {
        unimplemented!()
    }

    #[action]
    fn reject(inviteKey: Spki) {
        unimplemented!()
    }

    #[action]
    fn delInvite(inviteKey: Spki) {
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
    fn getInvite(pubkey: Spki) -> Option<super::InviteRecord> {
        unimplemented!()
    }
    #[action]
    fn isExpired(pubkey: Spki) -> bool {
        unimplemented!()
    }
    #[action]
    fn checkClaim(actor: AccountNumber, pubkey: Spki) {
        unimplemented!()
    }
}
