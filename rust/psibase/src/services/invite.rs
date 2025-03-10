pub use crate::services::auth_sig::SubjectPublicKeyInfo;
use crate::{account, AccountNumber};
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
    pubkey: SubjectPublicKeyInfo,

    /// An optional secondary identifier for the invite
    id: Option<u32>,

    /// The creator of the invite object
    inviter: AccountNumber,

    /// The application that created the invite
    app: Option<AccountNumber>,

    /// The domain of the application that created the invite
    appDomain: Option<String>,

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

    /// Encrypted invite secret
    secret: Option<String>,
}

#[derive(Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, SimpleObject, InputObject)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "NewAccountRecordInput")]
pub struct NewAccountRecord {
    name: AccountNumber,
    invitee: AccountNumber,
}

use crate as psibase;
pub const PAYER_ACCOUNT: AccountNumber = account!("invited-sys");

#[crate::service(name = "invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
    use crate::{http::HttpRequest, AccountNumber};

    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    #[action]
    fn createInvite(
        inviteKey: SubjectPublicKeyInfo,
        id: Option<u32>,
        secret: Option<String>,
        app: Option<AccountNumber>,
        appDomain: Option<String>,
    ) {
        unimplemented!()
    }

    #[action]
    fn accept(inviteKey: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    #[action]
    fn acceptCreate(
        inviteKey: SubjectPublicKeyInfo,
        acceptedBy: AccountNumber,
        newAccountKey: SubjectPublicKeyInfo,
    ) {
        unimplemented!()
    }

    #[action]
    fn reject(inviteKey: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    #[action]
    fn delInvite(inviteKey: SubjectPublicKeyInfo) {
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
    fn getInvite(pubkey: SubjectPublicKeyInfo) -> Option<super::InviteRecord> {
        unimplemented!()
    }
    #[action]
    fn isExpired(pubkey: SubjectPublicKeyInfo) -> bool {
        unimplemented!()
    }
    #[action]
    fn checkClaim(actor: AccountNumber, pubkey: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}
