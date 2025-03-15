pub use crate::services::auth_sig::SubjectPublicKeyInfo;
use crate::{account, AccountNumber, TimePointUSec};
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
    /// Monotonically increasing ID of the invite
    inviteId: u32,

    /// The public key of the invite. This uniquely identifies an invite and
    ///   may also used to authenticate the transaction accepting the invite.
    pubkey: SubjectPublicKeyInfo,

    /// An optional secondary identifier for the invite
    secondaryId: Option<u32>,

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

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
pub struct Updated {
    pub inviteId: u32,
    pub actor: AccountNumber,
    pub datetime: TimePointUSec,
    pub event: String,
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
    use crate::AccountNumber;

    #[action]
    fn createInvite(
        inviteKey: SubjectPublicKeyInfo,
        secondaryId: Option<u32>,
        secret: Option<String>,
        app: Option<AccountNumber>,
        appDomain: Option<String>,
    ) -> u32 {
        unimplemented!()
    }

    #[action]
    fn accept(inviteId: u32) {
        unimplemented!()
    }

    #[action]
    fn acceptCreate(inviteId: u32, acceptedBy: AccountNumber, newAccountKey: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    #[action]
    fn reject(inviteId: u32) {
        unimplemented!()
    }

    #[action]
    fn delInvite(inviteId: u32) {
        unimplemented!()
    }

    #[action]
    fn delExpired(maxDeleted: u32) {
        unimplemented!()
    }

    // For synchronous calls between services:
    #[action]
    fn getInvite(inviteId: u32) -> Option<super::InviteRecord> {
        unimplemented!()
    }
    #[action]
    fn isExpired(inviteId: u32) -> bool {
        unimplemented!()
    }
    #[action]
    fn checkClaim(actor: AccountNumber, inviteId: u32) {
        unimplemented!()
    }
}
