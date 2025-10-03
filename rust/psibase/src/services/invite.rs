pub use crate::services::auth_sig::SubjectPublicKeyInfo;
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
    /// The id of the invite (not sequential)
    id: u32,

    /// The id of the credential associated with the invite
    cid: u32,

    /// The creator of the invite object
    inviter: AccountNumber,

    /// Represents the number of accounts this invite can be used to create
    numAccounts: u16,

    /// A flag that represents whether to use hooks to notify the inviter when the invite is updated
    useHooks: bool,

    /// The encrypted secret used to redeem the invite
    secret: String,
}

#[crate::service(name = "invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    /// Creates and stores a new invite object that can be used to create a new account
    /// Returns the ID of the newly created invite
    ///
    /// Parameters:
    /// - `inviteId` is the id of the invite (could be randomly generated)
    /// - `inviteKey` is the public key of the invite
    /// - `numAccounts` is the number of accounts this invite can be used to create
    /// - `useHooks` is a flag that indicates whether to use hooks to notify the caller when
    ///    the invite is updated
    /// - `secret` is an encrypted secret used to redeem the invite
    ///
    /// If `useHooks` is true, the caller must be an account with a service deployed on it
    /// that implements the InviteHooks interface.
    #[action]
    fn createInvite(
        id: u32,
        inviteKey: SubjectPublicKeyInfo,
        numAccounts: u16,
        useHooks: bool,
        secret: String,
    ) -> u32 {
        unimplemented!()
    }

    /// Called by an invite credential (not a user account) to create the specified
    /// account. The new account is authorized by the specified public key.
    #[action]
    fn createAccount(account: AccountNumber, accountKey: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// The sender accepts an invite.
    /// Calling this action also requires that the sender authorizes the transaction with the
    /// proof for the credential associated with an invite.
    #[action]
    fn accept() {
        unimplemented!()
    }

    /// Delete the invite and its secret (if applicable).
    /// Can only be called by the invite creator.
    #[action]
    fn delInvite(inviteId: u32) {
        unimplemented!()
    }

    /// Called synchronously by other services to retrieve the specified invite record
    #[action]
    fn getInvite(inviteId: u32) -> Option<super::InviteRecord> {
        unimplemented!()
    }

    #[event(history)]
    pub fn updated(inviteId: u32, actor: AccountNumber, event: String) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
