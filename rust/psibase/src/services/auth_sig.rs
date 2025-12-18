use async_graphql::{scalar, InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use pem::{encode, parse, Pem};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, ToSchema, Pack, Unpack)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SubjectPublicKeyInfo(pub Vec<u8>);
scalar!(SubjectPublicKeyInfo);

impl Serialize for SubjectPublicKeyInfo {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let pem = Pem::new("PUBLIC KEY", self.0.clone());
        let pem_string = encode(&pem);
        serializer.serialize_str(&pem_string)
    }
}

impl<'de> Deserialize<'de> for SubjectPublicKeyInfo {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let pem_string: String = Deserialize::deserialize(deserializer)?;
        let pem = parse(&pem_string).map_err(serde::de::Error::custom)?;
        if pem.tag() != "PUBLIC KEY" {
            return Err(serde::de::Error::custom("Expected a PUBLIC KEY PEM"));
        }
        Ok(SubjectPublicKeyInfo(pem.contents().to_vec()))
    }
}

impl From<Vec<u8>> for SubjectPublicKeyInfo {
    fn from(data: Vec<u8>) -> Self {
        SubjectPublicKeyInfo(data)
    }
}

#[derive(
    Debug, Clone, Pack, Unpack, Serialize, Deserialize, ToSchema, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "AuthRecord")]
/// A record containing the authorization claims needed for an account using this auth service.
pub struct AuthRecord {
    /// The account whose transactions will be required to contain the specified public key.
    pub account: crate::AccountNumber,

    /// The public key included in the claims for each transaction sent by this account.
    pub pubkey: SubjectPublicKeyInfo,
}

/// The `auth-sig` service is an auth service that can be used to authenticate actions for accounts.
///
/// Any account using this auth service must store in this service a public key that they own.
/// This service will ensure that the specified public key is included in the transaction claims for any
/// transaction sent by this account.
///
/// This service supports K1 or R1 keys (Secp256K1 or Secp256R1) keys.
#[crate::service(name = "auth-sig", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::SubjectPublicKeyInfo;
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `transact` when an account using this auth service submits a
    /// transaction.
    ///
    /// This action verifies that the transaction contains a claim for the user's public key.
    #[action]
    fn checkAuthSys(
        flags: u32,
        requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        unimplemented!()
    }

    /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
    ///
    /// This action is automatically called by `accounts` when an account is configured to use this auth service.
    ///
    /// Verifies that a particular user is allowed to use a particular auth service.
    ///
    /// This action allows any user who has already set a public key using `AuthSig::setKey`.
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    /// Set the sender's public key
    ///
    /// This is the public key that must be claimed by the transaction whenever a sender using this auth service
    /// submits a transaction.
    #[action]
    fn setKey(key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being authorized.
    /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
    ///
    /// Returns:
    /// * `true`: If the sender is among the authorizers
    /// * `false`: If the sender is not among the authorizers
    #[action]
    fn isAuthSys(sender: AccountNumber, authorizers: Vec<AccountNumber>) -> bool {
        unimplemented!()
    }

    /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
    /// transaction from a specified sender.
    ///
    /// * `sender`: The sender account for the transaction potentially being rejected.
    /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
    ///
    /// Returns:
    /// * `true`: If the sender is among the rejecters
    /// * `false`: If the sender is not among the rejecters
    #[action]
    fn isRejectSys(sender: AccountNumber, authorizers: Vec<AccountNumber>) -> bool {
        unimplemented!()
    }

    /// Create a new account using this auth service configured with the specified public key.
    #[action]
    fn newAccount(name: AccountNumber, key: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
