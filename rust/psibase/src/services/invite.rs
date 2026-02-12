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

/// This interface should be implemented by a service that wants to handle hooks from the invite service
/// to be notified when an event occurs related to an invite.
#[crate::service(
    name = "invite-hooks",
    actions = "hooks_actions",
    wrapper = "hooks_wrapper",
    structs = "hooks_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod InviteHooks {
    use crate::AccountNumber;

    /// Called on the invite creator when the invite is accepted
    #[action]
    fn onInvAccept(inviteId: u32, accepter: AccountNumber) {
        unimplemented!()
    }
}

/// This service facilitates the creation and redemption of invites
///
/// Invites are generic and their acceptance can, but does not always, result
/// in the creation of a new account. This service can be used
/// by third party applications to streamline their user onboarding.
#[crate::service(name = "invite", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::auth_sig::SubjectPublicKeyInfo;
    use crate::services::tokens::Quantity;
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    /// Returns the current minimum cost of creating an invite that can create the specified number of
    /// accounts.
    #[action]
    fn getInvCost(numAccounts: u16) -> Quantity {
        unimplemented!()
    }

    /// Creates and stores a new invite object that can be used to create new accounts
    /// Returns the ID of the newly created invite
    ///
    /// Parameters:
    /// - `inviteId` is the id of the invite (could be randomly generated)
    /// - `fingerprint` is the fingerprint of the invite public key
    /// - `numAccounts` is the number of accounts this invite can be used to create
    /// - `useHooks` is a flag that indicates whether to use hooks to notify the caller when
    ///    the invite is updated
    /// - `secret` is an encrypted secret used to redeem the invite
    /// - `resources` is the amount of resources stored in the invite (used when creating
    ///               new accounts). The caller must send this amount of system tokens to this
    ///               invite service before calling this action. Use the query interface to check
    ///               the resources required for an invite of the specified number of accounts.
    ///
    /// If `useHooks` is true, the caller must be an account with a service deployed on it
    /// that implements the InviteHooks interface.
    #[action]
    fn createInvite(
        inviteId: u32,
        fingerprint: crate::Checksum256,
        numAccounts: u16,
        useHooks: bool,
        secret: String,
        resources: Quantity,
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
    /// proof for the credential associated with the invite.
    #[action]
    fn accept(inviteId: u32) {
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
