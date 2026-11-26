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

/// A key as a caller supplies it (C++ `SystemService::AuthSig::KeySpec`).
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct KeySpec {
    /// The public key
    pub key: SubjectPublicKeyInfo,
    /// The sequence value the key was derived with. Opaque to the chain: it
    /// is stored so that a device can derive the key again.
    pub seq: u64,
    /// The service that verifies signatures made with the key: one of the
    /// verifiers allowed for the key's type (`psibase::allowed_verifiers`).
    /// The default for the type if absent.
    pub verifier: Option<crate::AccountNumber>,
}

impl KeySpec {
    /// For a caller that has one key and no sequence values: used as both
    /// the owner and the active key, it gives an account that the one key
    /// controls completely.
    pub fn of(key: SubjectPublicKeyInfo) -> Self {
        KeySpec { key, seq: 0, verifier: None }
    }
}

/// A key of an account
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct AuthKey {
    /// The service that verifies signatures made with the key. A claim
    /// counts for this key only if it names this service.
    pub verifier: crate::AccountNumber,
    pub key: SubjectPublicKeyInfo,
    /// See `KeySpec::seq`
    pub seq: u64,
}

/// An owner key that was replaced without the recovery partner's
/// confirmation. Until `expires` it may pause the account once and may
/// freeze it.
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct PriorOwnerKey {
    pub verifier: crate::AccountNumber,
    pub key: SubjectPublicKeyInfo,
    pub seq: u64,
    /// The end of the key's freeze window
    pub expires: crate::TimePointSec,
    /// Whether the key has used its one pause
    pub paused: bool,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Key, psio::JsonText, psio::Serde)]
#[serde(rename_all = "camelCase")]
#[psio(custom = "AccountState")]
pub enum AccountState {
    /// Active authorizes ordinary actions, owner everything
    Normal,
    /// Nothing is authorized, except that an owner key may freeze
    Paused,
    /// Nothing is authorized; only the recovery partner releases it
    Frozen,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::Key, psio::JsonText, psio::Serde)]
#[serde(rename_all = "camelCase")]
#[psio(custom = "ChangeKind")]
pub enum ChangeKind {
    OwnerKeys,
    Partner,
    Delays,
}

/// A change that was requested and has not taken effect. The account is
/// paused while it is pending.
#[derive(Debug, Clone, PartialEq, Eq, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct PendingChange {
    pub kind: ChangeKind,
    /// ownerKeys: the new keys
    pub owner: Option<AuthKey>,
    pub active: Option<AuthKey>,
    /// partner: the new recovery partner, or nothing for none
    pub partner: Option<crate::AccountNumber>,
    /// delays: the new pause length and freeze window, in seconds
    pub pauseSeconds: Option<u32>,
    pub freezeSeconds: Option<u32>,
    /// When it was requested
    pub requested: crate::TimePointSec,
}

/// The record of an account, as stored. See C++
/// `SystemService::AuthSig::AuthRecord`: transitions that are due are not
/// applied in what is stored; the service's queries report the record as of
/// the current block.
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct AuthRecord {
    pub account: crate::AccountNumber,
    /// Authorizes everything, and is the only key accepted for the actions
    /// that change who controls the account
    pub owner: AuthKey,
    /// Authorizes ordinary actions
    pub active: AuthKey,
    /// The account that may confirm or reject a pending change, end a pause,
    /// and release a freeze
    pub partner: Option<crate::AccountNumber>,
    /// How long a pause lasts, in seconds
    pub pauseSeconds: u32,
    /// For how long a replaced owner key may still freeze the account, in seconds
    pub freezeSeconds: u32,
    pub state: AccountState,
    /// When the pause or freeze began
    pub stateSince: Option<crate::TimePointSec>,
    /// When the pause ends by itself. A freeze has no end.
    pub stateUntil: Option<crate::TimePointSec>,
    /// At most one
    pub pending: Option<PendingChange>,
    /// Replaced owner keys still in their freeze windows
    pub priorOwners: Vec<PriorOwnerKey>,
    /// The id the next recovery request of this account gets
    pub nextRequestId: u32,
}

/// Keys proposed for a frozen account by a holder of one of its owner keys
#[derive(Debug, Clone, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText, psio::Serde)]
pub struct RecoveryRequest {
    pub account: crate::AccountNumber,
    pub id: u32,
    pub owner: AuthKey,
    pub active: AuthKey,
    /// The owner key, current or replaced, that signed the proposal
    pub signedBy: AuthKey,
    pub time: crate::TimePointSec,
}

/// The `auth-sig` service authenticates the actions of accounts that are
/// controlled by keys: an active key for ordinary actions and an owner key
/// for everything, with changes of control that are pending, pausable and
/// freezable. The authority is the C++ service
/// (`packages/system/AuthSig/include/services/system/AuthSig.hpp`); see it
/// for the rules.
#[crate::service(name = "auth-sig", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::KeySpec;
    use crate::{services::transact::ServiceMethod, AccountNumber, Claim};

    /// Decides whether the claims of a transaction authorize `action` for
    /// `sender`, from the strongest key the claims count for, the state of
    /// the account, and the action.
    #[action]
    fn checkAuthSys(
        flags: u32,
        sender: AccountNumber,
        action: ServiceMethod,
        claims: Vec<Claim>,
    ) -> bool {
        unimplemented!()
    }

    /// Allows any user who has keys in this service.
    #[action]
    fn canAuthUserSys(user: AccountNumber) {
        unimplemented!()
    }

    /// Create a new account using this auth service, with the specified
    /// keys. The sender becomes the account's recovery partner. A caller
    /// that has a single key passes it as both (`KeySpec::of`).
    #[action]
    fn newAccount(name: AccountNumber, owner: KeySpec, active: KeySpec) {
        unimplemented!()
    }

    /// Store the sender's keys, for an account that does not use this auth
    /// service: `setKeys`, then `accounts::setAuthServ`.
    #[action]
    fn setKeys(owner: KeySpec, active: KeySpec) {
        unimplemented!()
    }

    /// Replace the sender's active key. Owner key only. Immediate.
    #[action]
    fn setActive(active: KeySpec) {
        unimplemented!()
    }

    /// Request new owner and active keys for the sender. Owner key only.
    /// The account is paused and the change is pending.
    #[action]
    fn requestOwnerChange(owner: KeySpec, active: KeySpec) {
        unimplemented!()
    }

    /// Request a new recovery partner for the sender, or none. Owner key
    /// only. Pending in the same way as an owner-key change.
    #[action]
    fn requestPartnerChange(partner: Option<AccountNumber>) {
        unimplemented!()
    }

    /// Request a new pause length and freeze window for the sender, in
    /// seconds. Owner key only. Pending in the same way.
    #[action]
    fn requestDelays(pauseSeconds: u32, freezeSeconds: u32) {
        unimplemented!()
    }

    /// Pause the sender. With the owner key, or once with a replaced owner
    /// key still in its freeze window.
    #[action]
    fn pause() {
        unimplemented!()
    }

    /// Freeze the sender. With the owner key or a replaced owner key still
    /// in its freeze window.
    #[action]
    fn freeze() {
        unimplemented!()
    }

    /// Propose new keys for the sender, which must be frozen. Returns the
    /// id of the recovery request.
    #[action]
    fn proposeRecovery(owner: KeySpec, active: KeySpec) -> u32 {
        unimplemented!()
    }

    /// By the recovery partner: the pending change takes effect now.
    #[action]
    fn confirm(account: AccountNumber) {
        unimplemented!()
    }

    /// By the recovery partner: the pending change is dropped.
    #[action]
    fn reject(account: AccountNumber) {
        unimplemented!()
    }

    /// By the recovery partner: end a pause that has no pending change.
    #[action]
    fn endPause(account: AccountNumber) {
        unimplemented!()
    }

    /// By the recovery partner: install the keys of a recovery request.
    #[action]
    fn unfreeze(account: AccountNumber, requestId: u32) {
        unimplemented!()
    }

    /// By the recovery partner: drop a recovery request.
    #[action]
    fn rejectRecovery(account: AccountNumber, requestId: u32) {
        unimplemented!()
    }

    /// By the recovery partner of a frozen account: install these keys.
    #[action]
    fn unfreezeWith(account: AccountNumber, owner: KeySpec, active: KeySpec) {
        unimplemented!()
    }

    /// Write the account's record as it is now. Anyone may call it.
    #[action]
    fn refresh(account: AccountNumber) {
        unimplemented!()
    }

    /// Get the accounts this auth service delegates authority to for a sender: none.
    #[action]
    fn getDlgsSys(sender: AccountNumber, method: Option<ServiceMethod>) -> Vec<AccountNumber> {
        unimplemented!()
    }

    /// `true` only if the sender is among the authorizers, the account is
    /// in its normal state, and `method` is not a control action.
    #[action]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }

    /// `true` if the sender is among the rejecters.
    #[action]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        method: Option<ServiceMethod>,
    ) -> bool {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
