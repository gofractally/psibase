use super::gql::Queryable;
use crate::service::{Attestation, AttestationStats};
use crate::Wrapper as Identity;
use psibase::services::http_server;
use psibase::AccountNumber;
use std::fmt::Debug;

pub trait HasQueryFields {
    const QUERY_FIELDS: &'static str;
}

#[derive(Clone, Debug)]
pub struct PartialAttestation {
    pub attester: AccountNumber,
    pub subject: AccountNumber,
    pub value: u8,
}
impl PartialAttestation {
    pub fn new(attester: &str, subject: &str, value: u8) -> Self {
        Self {
            attester: attester.into(),
            subject: subject.into(),
            value,
        }
    }
}
impl HasQueryFields for Attestation {
    const QUERY_FIELDS: &'static str = "attester, subject, value, issued { seconds }";
}

#[derive(Clone, Debug, PartialEq)]
#[allow(non_snake_case)]
pub struct PartialAttestationStats {
    pub subject: AccountNumber,
    pub uniqueAttesters: u16,
    pub numHighConfAttestations: u16,
}
impl PartialAttestationStats {
    pub fn new(subject: &str, unique_attesters: u16, num_high_conf_attestations: u16) -> Self {
        Self {
            subject: subject.into(),
            uniqueAttesters: unique_attesters,
            numHighConfAttestations: num_high_conf_attestations,
        }
    }
}
impl HasQueryFields for AttestationStats {
    const QUERY_FIELDS: &'static str =
        "subject, uniqueAttesters, numHighConfAttestations, mostRecentAttestation { seconds }";
}

// Todo: implement a ServiceWrapper trait on the Wrapper itself, instead of needing a wrapper object
pub trait IsServiceWrapper {
    const SERVICE: psibase::AccountNumber;
    fn push_from(
        chain: &psibase::Chain,
        account: AccountNumber,
    ) -> crate::Actions<psibase::ChainPusher>;
}
impl IsServiceWrapper for Identity {
    const SERVICE: psibase::AccountNumber = Identity::SERVICE;
    fn push_from(
        chain: &psibase::Chain,
        account: AccountNumber,
    ) -> crate::Actions<psibase::ChainPusher> {
        Identity::push_from(chain, account)
    }
}

pub struct ChainPusher<'a, T: IsServiceWrapper> {
    chain: &'a psibase::Chain,
    _marker: core::marker::PhantomData<T>,
}

impl<'a, T: IsServiceWrapper> ChainPusher<'a, T> {
    fn new(chain: &'a psibase::Chain) -> Self {
        ChainPusher::<T> {
            chain,
            _marker: core::marker::PhantomData,
        }
    }

    /// Push an action from the specified account
    pub fn from(&self, account: &str) -> crate::Actions<psibase::ChainPusher> {
        T::push_from(self.chain, account.into())
    }

    /// Make the specified graphql query on this service.
    /// It will attempt to unpack into the specified template type
    pub fn query<U>(&self, query_name: &str, params: &[(&str, &str)]) -> U
    where
        U: Queryable,
    {
        U::query(self.chain, T::SERVICE, query_name, params)
    }
}

pub fn init_identity_svc(chain: &psibase::Chain) -> ChainPusher<Identity> {
    http_server::Wrapper::push_from(&chain, Identity::SERVICE).registerServer(Identity::SERVICE);
    ChainPusher::<Identity>::new(&chain)
}

impl PartialEq<PartialAttestationStats> for AttestationStats {
    fn eq(&self, other: &PartialAttestationStats) -> bool {
        self.subject == other.subject
            && self.uniqueAttesters == other.uniqueAttesters
            && self.numHighConfAttestations == other.numHighConfAttestations
    }
}
impl PartialEq<AttestationStats> for PartialAttestationStats {
    fn eq(&self, other: &AttestationStats) -> bool {
        other == self
    }
}
impl PartialEq<PartialAttestation> for Attestation {
    fn eq(&self, other: &PartialAttestation) -> bool {
        self.attester == other.attester
            && self.subject == other.subject
            && self.value == other.value
    }
}
impl PartialEq<Attestation> for PartialAttestation {
    fn eq(&self, other: &Attestation) -> bool {
        other == self
    }
}
