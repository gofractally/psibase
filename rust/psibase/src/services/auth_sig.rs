use async_graphql::{InputObject, SimpleObject};

/// A public key: the DER bytes of an X.509 SubjectPublicKeyInfo.
///
/// Wherever it is packed it is its bytes (`transparent`); they are not
/// parsed when a key is unpacked. Its text, which is its JSON (also through
/// serde and in GraphQL), is the PEM armor of the bytes:
/// `-----BEGIN PUBLIC KEY-----`, base64 in lines of 64 characters,
/// `-----END PUBLIC KEY-----`, each line ended by a line feed. White space
/// around the armor and inside the body is ignored when text is read. Text
/// is a key when it is that armor around base64 of bytes shaped
/// `SEQUENCE { SEQUENCE { OBJECT IDENTIFIER … }, BIT STRING }`; the
/// algorithm and the key material are not examined (C++
/// `SystemService::AuthSig::SubjectPublicKeyInfo`, the authority).
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Serde)]
#[psio(transparent, custom = "SubjectPublicKeyInfo")]
pub struct SubjectPublicKeyInfo(pub Vec<u8>);

impl psio::json::TextForm for SubjectPublicKeyInfo {
    fn to_text(&self, out: &mut String) {
        pem::encode(&self.0, out);
    }
    fn from_text(text: &str) -> Option<Self> {
        let der = pem::decode(text)?;
        pem::has_subject_public_key_info_shape(&der).then_some(SubjectPublicKeyInfo(der))
    }
}
psio::json_text_form!(SubjectPublicKeyInfo);
psio::async_graphql_scalar!(SubjectPublicKeyInfo, "SubjectPublicKeyInfo");

impl std::fmt::Display for SubjectPublicKeyInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut text = String::new();
        psio::json::TextForm::to_text(self, &mut text);
        f.write_str(&text)
    }
}

impl std::str::FromStr for SubjectPublicKeyInfo {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        <Self as psio::json::TextForm>::from_text(s)
            .ok_or_else(|| anyhow::anyhow!("SubjectPublicKeyInfo: not a PEM encoded public key"))
    }
}

/// The PEM armor of a public key and the outer shape of its DER bytes, as
/// C++ `psibase/pem.hpp` defines them.
mod pem {
    const LABEL: &str = "PUBLIC KEY";
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(der: &[u8], out: &mut String) {
        let mut body = String::with_capacity(der.len().div_ceil(3) * 4);
        for chunk in der.chunks(3) {
            let n = (chunk[0] as u32) << 16
                | (*chunk.get(1).unwrap_or(&0) as u32) << 8
                | *chunk.get(2).unwrap_or(&0) as u32;
            for i in 0..4 {
                if i <= chunk.len() {
                    body.push(ALPHABET[(n >> (18 - 6 * i) & 0x3f) as usize] as char);
                } else {
                    body.push('=');
                }
            }
        }
        out.push_str("-----BEGIN ");
        out.push_str(LABEL);
        out.push_str("-----\n");
        for line in body.as_bytes().chunks(64) {
            out.push_str(std::str::from_utf8(line).unwrap());
            out.push('\n');
        }
        out.push_str("-----END ");
        out.push_str(LABEL);
        out.push_str("-----\n");
    }

    fn is_space(c: char) -> bool {
        matches!(c, ' ' | '\t' | '\r' | '\n')
    }

    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let text = text.trim_matches(is_space);
        let text = text.strip_prefix("-----BEGIN ")?.strip_prefix(LABEL)?.strip_prefix("-----")?;
        let end = text.find('-')?;
        let body: Vec<u8> = text[..end].bytes().filter(|b| !is_space(*b as char)).collect();
        let rest = text[end..].strip_prefix("-----END ")?.strip_prefix(LABEL)?.strip_prefix("-----")?;
        if !rest.is_empty() || body.len() % 4 != 0 {
            return None;
        }
        let mut digits = &body[..];
        for _ in 0..2 {
            if let Some(shorter) = digits.strip_suffix(b"=") {
                digits = shorter;
            }
        }
        let mut bytes = Vec::with_capacity(digits.len() / 4 * 3 + 2);
        let (mut bits, mut count) = (0u32, 0u32);
        for &c in digits {
            let value = ALPHABET.iter().position(|&a| a == c)? as u32;
            bits = bits << 6 | value;
            count += 6;
            if count >= 8 {
                count -= 8;
                bytes.push((bits >> count) as u8);
                bits &= (1 << count) - 1;
            }
        }
        // What is left is padding: fewer than six bits, all zero.
        (count < 6 && bits == 0).then_some(bytes)
    }

    /// One DER element with a definite length: its tag and its content;
    /// `input` is left after it.
    fn read_der<'a>(input: &mut &'a [u8]) -> Option<(u8, &'a [u8])> {
        let bytes = *input;
        if bytes.len() < 2 {
            return None;
        }
        let tag = bytes[0];
        // A multi-byte tag number does not occur in a SubjectPublicKeyInfo.
        if tag & 0x1f == 0x1f {
            return None;
        }
        let mut pos = 2;
        let mut length = bytes[1] as usize;
        if length & 0x80 != 0 {
            let count = length & 0x7f;
            // 0x80 is the indefinite form, which DER does not have.
            if count == 0 || count > std::mem::size_of::<usize>() || bytes.len() - pos < count {
                return None;
            }
            length = 0;
            for _ in 0..count {
                length = length << 8 | bytes[pos] as usize;
                pos += 1;
            }
        }
        if bytes.len() - pos < length {
            return None;
        }
        *input = &bytes[pos + length..];
        Some((tag, &bytes[pos..pos + length]))
    }

    pub fn has_subject_public_key_info_shape(der: &[u8]) -> bool {
        const SEQUENCE: u8 = 0x30;
        const OID: u8 = 0x06;
        const BIT_STRING: u8 = 0x03;
        let shape = || -> Option<bool> {
            let mut der = der;
            let (tag, mut members) = read_der(&mut der)?;
            if tag != SEQUENCE || !der.is_empty() {
                return None;
            }
            let (tag, mut algorithm) = read_der(&mut members)?;
            if tag != SEQUENCE {
                return None;
            }
            let (tag, key) = read_der(&mut members)?;
            if tag != BIT_STRING || !members.is_empty() {
                return None;
            }
            let (tag, id) = read_der(&mut algorithm)?;
            if tag != OID || id.is_empty() {
                return None;
            }
            // The first byte of a BIT STRING counts the unused bits of its last byte.
            Some(!key.is_empty() && key[0] <= 7)
        };
        shape().unwrap_or(false)
    }
}

impl From<Vec<u8>> for SubjectPublicKeyInfo {
    fn from(data: Vec<u8>) -> Self {
        SubjectPublicKeyInfo(data)
    }
}

#[derive(
    Debug,
    Clone,
    SimpleObject,
    InputObject,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::PsszView,
    psio::ToPsszSchema,
    psio::JsonText,
    psio::Serde,
)]
#[graphql(input_name = "AuthRecord")]
/// A record containing the authorization claims needed for an account using this auth service.
pub struct AuthRecord {
    /// The account whose transactions will be required to contain the specified public key.
    pub account: crate::AccountNumber,

    /// The public key included in the claims for each transaction sent by this account.
    pub pubkey: SubjectPublicKeyInfo,

    /// The service that verifies signatures made with the key: the service the
    /// account's claims must name. One of the verifiers allowed for the key's
    /// type (`psibase::allowed_verifiers`); the default for the type unless the
    /// account chose another with `setKeyVerifier`.
    pub verifier: crate::AccountNumber,
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
    /// This action verifies that the transaction contains a claim for the user's public key
    /// that names the verifier stored with the key.
    #[action]
    fn checkAuthSys(
        flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
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
    /// submits a transaction. Signatures are verified by the default verifier for the key's type.
    #[action]
    fn setKey(key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Set the sender's public key and choose the service that verifies its signatures
    ///
    /// `verifier` must be one of the verifiers allowed for the key's type; see
    /// `psibase::allowed_verifiers`. From then on the sender's claims must name `verifier`,
    /// and claims that name any other service are refused, including the default
    /// verifier for the key's type.
    #[action]
    fn setKeyVerifier(verifier: AccountNumber, key: SubjectPublicKeyInfo) {
        unimplemented!()
    }

    /// Get the accounts this auth service delegates authority to for a sender.
    #[action]
    fn getDlgsSys(sender: AccountNumber) -> Vec<AccountNumber> {
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
    fn isRejectSys(sender: AccountNumber, rejecters: Vec<AccountNumber>) -> bool {
        unimplemented!()
    }

    /// Create a new account using this auth service configured with the specified public key.
    /// Signatures are verified by the default verifier for the key's type.
    #[action]
    fn newAccount(name: AccountNumber, key: SubjectPublicKeyInfo) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
