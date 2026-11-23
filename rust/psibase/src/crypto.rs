use p256::ecdsa::{SigningKey, VerifyingKey};
use p256::pkcs8::{EncodePrivateKey, EncodePublicKey};
use rand_core::OsRng;

use custom_error::custom_error;
use std::str::FromStr;

use der::asn1::{AnyRef, BitStringRef};
#[cfg(not(target_family = "wasm"))]
use der::{
    asn1::{ObjectIdentifier, OctetStringRef},
    Decode, Encode,
};
#[cfg(not(target_family = "wasm"))]
use spki::SubjectPublicKeyInfo;

#[cfg(not(target_family = "wasm"))]
use sha2::{Digest, Sha256};

#[cfg(not(target_family = "wasm"))]
use subprocess::{Exec, Redirection};

#[cfg(not(target_family = "wasm"))]
use cryptoki::{
    context::{CInitializeArgs, Pkcs11},
    mechanism::Mechanism,
    object::{Attribute, AttributeType, KeyType, ObjectClass, ObjectHandle},
    session::{Session, SessionState, UserType},
    slot::{Slot, SlotInfo, TokenInfo},
    types::{AuthPin, RawAuthPin, Version},
};
#[cfg(not(target_family = "wasm"))]
use cryptoki_sys::CK_VERSION;

#[cfg(not(target_family = "wasm"))]
use std::{
    collections::{hash_map, HashMap},
    sync::{Arc, Mutex, OnceLock},
};

#[cfg(not(target_family = "wasm"))]
use percent_encoding::percent_decode_str;
#[cfg(not(target_family = "wasm"))]
use url::Url;

use crate::{account_raw, AccountNumber};

custom_error! {
    #[allow(clippy::enum_variant_names)] pub Error

    InvalidKey          = "Invalid key",
    ExpectedPublicKey   = "Expected public key",
    ExpectedPrivateKey  = "Expected private key",
    InvalidPKCS11URI    = "Invalid PKCS #11 URI",
    NoMatchingKey       = "Key not found",
    PublicKeyNotFound   = "Public key not found",
    KeyTypeNotSupported = "Key type not supported",
    BadPinSource        = "Cannot interpret pin-source",
    PublicKeyRequired   = "Private key does not include public key",
}

#[cfg(not(target_family = "wasm"))]
custom_error! { pub K1Error
    OnlyK1              = "Only K1 keys are fully supported",
    Msg{s:String}       = "{s}",
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
struct PKCS8PrivateKeyK1 {
    key: secp256k1::SecretKey,
    pubkey: Vec<u8>,
}

#[cfg(not(target_family = "wasm"))]
pub trait Signer: std::fmt::Debug + Sync + Send {
    fn get_claim(&self) -> crate::Claim;
    fn sign(&self, data: &[u8]) -> Vec<u8>;
}

#[cfg(not(target_family = "wasm"))]
const OID_ECDSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.2.1");
#[cfg(not(target_family = "wasm"))]
const OID_SECP256K1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.10");
#[cfg(not(target_family = "wasm"))]
const OID_NIST_P256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7");

#[cfg(not(target_family = "wasm"))]
impl Signer for PKCS8PrivateKeyK1 {
    fn get_claim(&self) -> crate::Claim {
        crate::Claim {
            service: AccountNumber::new(account_raw!("verify-sig")),
            rawData: self.pubkey.clone().into(),
        }
    }
    fn sign(&self, data: &[u8]) -> Vec<u8> {
        let digest = secp256k1::Message::from_hashed_data::<secp256k1::hashes::sha256::Hash>(data);
        secp256k1::SECP256K1
            .sign_ecdsa(&digest, &self.key)
            .serialize_compact()
            .into()
    }
}

/// The group order n of a curve, big-endian, if `spki` is a public key on
/// secp256k1 or P-256.
#[cfg(not(target_family = "wasm"))]
fn group_order(spki: &[u8]) -> Option<[u8; 32]> {
    const K1_OID: [u8; 7] = [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a];
    const R1_OID: [u8; 10] = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
    const K1_ORDER: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xfe, 0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36,
        0x41, 0x41,
    ];
    const R1_ORDER: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63,
        0x25, 0x51,
    ];
    let contains = |oid: &[u8]| spki.windows(oid.len()).any(|w| w == oid);
    if contains(&K1_OID) {
        Some(K1_ORDER)
    } else if contains(&R1_OID) {
        Some(R1_ORDER)
    } else {
        None
    }
}

/// Rewrites a 64-byte r || s ECDSA signature into the low-S form, s <= n/2.
/// verify-sig accepts no other form. (r, n - s) is the same signature with
/// the other of its two encodings.
#[cfg(not(target_family = "wasm"))]
fn normalize_signature(mut signature: Vec<u8>, pubkey: &[u8]) -> Vec<u8> {
    let Some(order) = group_order(pubkey) else {
        return signature;
    };
    if signature.len() != 64 {
        return signature;
    }
    // other = n - s
    let mut other = [0u8; 32];
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let d = order[i] as i16 - signature[32 + i] as i16 - borrow;
        borrow = (d < 0) as i16;
        other[i] = (d + 256 * borrow) as u8;
    }
    // s > n/2 exactly when n - s < s, because n is odd.
    if other[..] < signature[32..] {
        signature[32..].copy_from_slice(&other);
    }
    signature
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug)]
struct EcdsaPrivateKey {
    key_pair: ring::signature::EcdsaKeyPair,
    pubkey: Vec<u8>,
}

#[cfg(not(target_family = "wasm"))]
fn get_system_random() -> &'static ring::rand::SystemRandom {
    static INSTANCE: OnceLock<ring::rand::SystemRandom> = OnceLock::new();
    INSTANCE.get_or_init(|| ring::rand::SystemRandom::new())
}

#[cfg(not(target_family = "wasm"))]
impl Signer for EcdsaPrivateKey {
    fn get_claim(&self) -> crate::Claim {
        crate::Claim {
            service: AccountNumber::new(account_raw!("verify-sig")),
            rawData: crate::Hex::from(self.pubkey.clone()),
        }
    }
    fn sign(&self, data: &[u8]) -> Vec<u8> {
        let signature = self
            .key_pair
            .sign(get_system_random(), data)
            .expect("Failed to sign")
            .as_ref()
            .to_vec();
        normalize_signature(signature, &self.pubkey)
    }
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
struct PKCS11PrivateKey {
    session: Arc<Mutex<Session>>,
    key: ObjectHandle,
    pubkey: Vec<u8>,
}

#[cfg(not(target_family = "wasm"))]
fn extract_first<T>(mut v: Vec<T>) -> Result<T, Error> {
    v.truncate(1);
    if let Some(result) = v.pop() {
        Ok(result)
    } else {
        Err(Error::PublicKeyNotFound)
    }
}

#[cfg(not(target_family = "wasm"))]
fn get_ec_public_key_der(session: &Session, key: ObjectHandle) -> Result<Vec<u8>, anyhow::Error> {
    let attrs = session.get_attributes(key, &[AttributeType::EcParams, AttributeType::EcPoint])?;
    let [Attribute::EcParams(params), Attribute::EcPoint(point)] = &attrs[..] else {
        return Err(Error::PublicKeyNotFound)?;
    };

    let algid = spki::AlgorithmIdentifier {
        oid: OID_ECDSA,
        parameters: Some(ObjectIdentifier::from_der(&params)?),
    };
    Ok(Encode::to_der(&SubjectPublicKeyInfo {
        algorithm: algid,
        subject_public_key: BitStringRef::from_bytes(OctetStringRef::from_der(&point)?.as_bytes())?,
    })?)
}

#[cfg(not(target_family = "wasm"))]
fn get_public_key_der(session: &Session, key: ObjectHandle) -> Result<Vec<u8>, anyhow::Error> {
    match session.get_attributes(key, &[AttributeType::Class, AttributeType::KeyType])?[..] {
        [Attribute::Class(ObjectClass::PUBLIC_KEY), Attribute::KeyType(KeyType::EC)] => {
            get_ec_public_key_der(session, key)
        }
        _ => Err(Error::KeyTypeNotSupported)?,
    }
}

#[cfg(not(target_family = "wasm"))]
fn lookup_public_key(session: &Session, key: ObjectHandle) -> Result<ObjectHandle, anyhow::Error> {
    let id = extract_first(session.get_attributes(key, &[AttributeType::Id])?)?;
    Ok(extract_first(session.find_objects(&[
        id,
        Attribute::Class(ObjectClass::PUBLIC_KEY),
    ])?)?)
}

#[cfg(not(target_family = "wasm"))]
impl Signer for PKCS11PrivateKey {
    fn get_claim(&self) -> crate::Claim {
        crate::Claim {
            service: AccountNumber::new(account_raw!("verify-sig")),
            rawData: crate::Hex::from(self.pubkey.clone()),
        }
    }
    fn sign(&self, data: &[u8]) -> Vec<u8> {
        let digest = Sha256::digest(data);
        let session = self.session.lock().unwrap();
        // The token returns whichever s it computed.
        let signature = session.sign(&Mechanism::Ecdsa, self.key, &digest).unwrap();
        normalize_signature(signature, &self.pubkey)
    }
}

#[cfg(not(target_family = "wasm"))]
struct PKCS11URI {
    // query
    pin_value: Option<String>,
    pin_source: Option<String>,
    module_path: Option<String>,
    module_name: Option<String>,
    // library
    library_description: Option<String>,
    library_manufacturer: Option<String>,
    library_version: Option<Version>,
    // slot
    slot_description: Option<String>,
    slot_id: Option<Slot>,
    slot_manufacturer: Option<String>,
    // token
    manufacturer: Option<String>,
    model: Option<String>,
    serial: Option<String>,
    token: Option<String>,
    // object
    id: Option<Vec<u8>>,
    object: Option<Vec<u8>>,
    type_: Option<ObjectClass>,
}

#[cfg(not(target_family = "wasm"))]
fn parse_version(v: &str) -> Result<Version, anyhow::Error> {
    if let Some((major, minor)) = v.split_once('.') {
        return Ok(Version::from(CK_VERSION {
            major: major.parse()?,
            minor: minor.parse()?,
        }));
    } else {
        return Err(Error::InvalidPKCS11URI)?;
    }
}

#[cfg(not(target_family = "wasm"))]
impl FromStr for PKCS11URI {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<PKCS11URI, anyhow::Error> {
        let url = Url::parse(s)?;
        let mut result = PKCS11URI {
            pin_value: None,
            pin_source: None,
            module_path: None,
            module_name: None,
            library_description: None,
            library_manufacturer: None,
            library_version: None,
            slot_description: None,
            slot_id: None,
            slot_manufacturer: None,
            manufacturer: None,
            model: None,
            serial: None,
            token: None,
            id: None,
            object: None,
            type_: None,
        };
        for (k, v) in url.query_pairs() {
            match &k as &str {
                "pin-value" => {
                    result.pin_value = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                }
                "pin-source" => {
                    result.pin_source = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                }
                "module-path" => {
                    result.module_path = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                }
                "module-name" => {
                    result.module_name = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                }
                _ => return Err(Error::InvalidPKCS11URI.into()),
            }
        }
        for attr in url.path().split(';') {
            if let Some((k, v)) = attr.split_once('=') {
                match k {
                    "library-description" => {
                        result.library_description =
                            Some(String::from_utf8(percent_decode_str(v).collect())?)
                    }
                    "library-manufacturer" => {
                        result.library_manufacturer =
                            Some(String::from_utf8(percent_decode_str(v).collect())?)
                    }
                    "library-version" => result.library_version = Some(parse_version(v)?),
                    "slot-description" => {
                        result.slot_description =
                            Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "slot-id" => {
                        result.slot_id = Some(Slot::try_from(u64::from_str(&String::from_utf8(
                            percent_decode_str(&v).collect(),
                        )?)?)?)
                    }
                    "slot-manufacturer" => {
                        result.slot_manufacturer =
                            Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "manufacturer" => {
                        result.manufacturer =
                            Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "model" => {
                        result.model = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "serial" => {
                        result.serial = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "token" => {
                        result.token = Some(String::from_utf8(percent_decode_str(&v).collect())?)
                    }
                    "id" => result.id = Some(percent_decode_str(v).collect()),
                    "object" => result.object = Some(percent_decode_str(v).collect()),
                    "type" => {
                        result.type_ = Some(
                            match String::from_utf8(percent_decode_str(&v).collect())?.as_str() {
                                "cert" => ObjectClass::CERTIFICATE,
                                "data" => ObjectClass::DATA,
                                "private" => ObjectClass::PRIVATE_KEY,
                                "public" => ObjectClass::PUBLIC_KEY,
                                "secret-key" => ObjectClass::SECRET_KEY,
                                _ => Err(Error::InvalidPKCS11URI)?,
                            },
                        )
                    }
                    _ => return Err(Error::InvalidPKCS11URI.into()),
                }
            } else {
                return Err(Error::InvalidPKCS11URI.into());
            }
        }
        Ok(result)
    }
}

#[cfg(not(target_family = "wasm"))]
impl PKCS11URI {
    fn matches_slot(&self, slot: Slot, sinfo: &SlotInfo) -> bool {
        if let Some(desc) = &self.slot_description {
            if desc != sinfo.slot_description() {
                return false;
            }
        }
        if let Some(id) = self.slot_id {
            if id != slot {
                return false;
            }
        }
        if let Some(manuf) = &self.slot_manufacturer {
            if manuf != sinfo.manufacturer_id() {
                return false;
            }
        }
        true
    }
    fn matches_token(&self, tinfo: &TokenInfo) -> bool {
        if let Some(manuf) = &self.manufacturer {
            if manuf != tinfo.manufacturer_id() {
                return false;
            }
        }
        if let Some(model) = &self.model {
            if model != tinfo.model() {
                return false;
            }
        }
        if let Some(serial) = &self.serial {
            if serial != tinfo.serial_number() {
                return false;
            }
        }
        if let Some(token) = &self.token {
            if token != tinfo.label() {
                return false;
            }
        }
        true
    }
    fn attrs(&self) -> Vec<Attribute> {
        let mut result = vec![];
        if let Some(id) = &self.id {
            result.push(Attribute::Id(id.clone()))
        }
        if let Some(object) = &self.object {
            result.push(Attribute::Label(object.clone()))
        }
        if let Some(type_) = self.type_ {
            result.push(Attribute::Class(type_))
        }
        result
    }
    fn get_module(&self) -> Result<String, anyhow::Error> {
        if let Some(path) = &self.module_path {
            Ok(path.to_string())
        } else if let Some(name) = &self.module_name {
            Ok(name.to_string() + ".so")
        } else {
            Ok("p11-kit-proxy.so".to_string())
        }
    }
}

fn read_key_file(
    key: &str,
    expected_label: &str,
    err: Error,
) -> Result<der::Document, anyhow::Error> {
    match der::Document::read_pem_file(key) {
        Ok((label, data)) => {
            if label != expected_label {
                Err(err.into())
            } else {
                Ok(data)
            }
        }
        Err(pem_err) => {
            if let Ok(data) = der::Document::read_der_file(key) {
                Ok(data)
            } else {
                Err(pem_err.into())
            }
        }
    }
}

#[cfg(not(target_family = "wasm"))]
struct PKCS11ModuleSet {
    modules: HashMap<String, (Pkcs11, HashMap<Slot, Arc<Mutex<Session>>>)>,
}

#[cfg(not(target_family = "wasm"))]
impl PKCS11ModuleSet {
    fn get_or_create(
        &mut self,
        filename: String,
    ) -> Result<&mut (Pkcs11, HashMap<Slot, Arc<Mutex<Session>>>), anyhow::Error> {
        match self.modules.entry(filename) {
            hash_map::Entry::Vacant(entry) => {
                let context = Pkcs11::new(entry.key())?;
                context.initialize(CInitializeArgs::OsThreads)?;
                Ok(entry.insert((context, HashMap::new())))
            }
            hash_map::Entry::Occupied(entry) => Ok(entry.into_mut()),
        }
    }
    fn instance() -> &'static Mutex<PKCS11ModuleSet> {
        static INSTANCE: OnceLock<Mutex<PKCS11ModuleSet>> = OnceLock::new();
        INSTANCE.get_or_init(|| {
            Mutex::new(PKCS11ModuleSet {
                modules: HashMap::new(),
            })
        })
    }
}

#[cfg(not(target_family = "wasm"))]
fn get_session<'a>(
    context: &Pkcs11,
    sessions: &'a mut HashMap<Slot, Arc<Mutex<Session>>>,
    slot: Slot,
) -> Result<&'a Arc<Mutex<Session>>, anyhow::Error> {
    match sessions.entry(slot) {
        hash_map::Entry::Vacant(entry) => {
            Ok(entry.insert(Arc::new(Mutex::new(context.open_ro_session(slot)?))))
        }
        hash_map::Entry::Occupied(entry) => Ok(entry.into_mut()),
    }
}

#[cfg(not(target_family = "wasm"))]
fn login(
    context: &Pkcs11,
    session: &Session,
    uri: &PKCS11URI,
    slot: Slot,
    prompt: bool,
) -> Result<(), anyhow::Error> {
    if session.get_session_info()?.session_state() == SessionState::RoUser {
        // Already logged in
    } else if let Some(pin) = &uri.pin_value {
        session.login(UserType::User, Some(&AuthPin::from_str(pin)?))?;
    } else if let Some(pin_source) = &uri.pin_source {
        if let Ok(pin_url) = Url::parse(pin_source) {
            if pin_url.scheme() == "file" {
                let pin = std::fs::read(pin_url.path())?;
                session.login_with_raw(UserType::User, &RawAuthPin::from(pin))?;
            } else {
                Err(Error::BadPinSource)?;
            }
        } else if pin_source.starts_with('|') {
            let pin = Exec::shell(&pin_source[1..])
                .stdout(Redirection::Pipe)
                .capture()?
                .stdout;
            session.login_with_raw(UserType::User, &RawAuthPin::from(pin))?;
        } else {
            Err(Error::BadPinSource)?;
        }
    } else if prompt {
        if context
            .get_token_info(slot)?
            .protected_authentication_path()
        {
            session.login(UserType::User, None)?;
        } else {
            // TODO: identify token
            let pin = rpassword::prompt_password("Enter pin: ")?;
            session.login(UserType::User, Some(&AuthPin::from_str(&pin)?))?;
        }
    }
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn load_pkcs11_private_key(key: &str) -> Result<Arc<dyn Signer>, anyhow::Error> {
    let mut uri = PKCS11URI::from_str(key)?;
    if let Some(class) = uri.type_ {
        if class != ObjectClass::PRIVATE_KEY {
            Err(Error::ExpectedPrivateKey)?
        }
    } else {
        uri.type_ = Some(ObjectClass::PRIVATE_KEY)
    }
    let mut modules = PKCS11ModuleSet::instance().lock().unwrap();
    let (context, sessions) = modules.get_or_create(uri.get_module()?)?;
    let attrs = uri.attrs();
    for slot in context.get_slots_with_initialized_token()? {
        if uri.matches_slot(slot, &context.get_slot_info(slot)?)
            && uri.matches_token(&context.get_token_info(slot)?)
        {
            let session_mutex = get_session(context, sessions, slot)?;
            let session = session_mutex.lock().unwrap();
            login(context, &session, &uri, slot, true)?;

            for obj in session.find_objects(&attrs)? {
                let result = PKCS11PrivateKey {
                    session: session_mutex.clone(),
                    key: obj,
                    pubkey: get_public_key_der(&session, lookup_public_key(&session, obj)?)?,
                };
                return Ok(Arc::new(result));
            }
        }
    }
    return Err(Error::NoMatchingKey.into());
}

#[cfg(not(target_family = "wasm"))]
pub fn load_private_key(key: &str) -> Result<Arc<dyn Signer>, anyhow::Error> {
    if key.starts_with("pkcs11:") {
        return load_pkcs11_private_key(key);
    }

    let data = read_key_file(key, "PRIVATE KEY", Error::ExpectedPrivateKey)?;
    let pkcs8_key = data.decode_msg::<pkcs8::PrivateKeyInfo>()?;
    match pkcs8_key.algorithm.oids()? {
        (OID_ECDSA, Some(oid)) => {
            let algid = spki::AlgorithmIdentifier {
                oid: OID_ECDSA,
                parameters: Some(oid),
            };

            let pubkey = sec1::EcPrivateKey::from_der(pkcs8_key.private_key)?.public_key;
            let pubkey_info = Encode::to_der(&SubjectPublicKeyInfo {
                algorithm: algid,
                subject_public_key: BitStringRef::from_bytes(
                    &pubkey.ok_or(Error::PublicKeyRequired)?,
                )?,
            })?;
            match oid {
                OID_SECP256K1 => Ok(Arc::new(PKCS8PrivateKeyK1 {
                    key: secp256k1::SecretKey::from_slice(
                        sec1::EcPrivateKey::from_der(pkcs8_key.private_key)?.private_key,
                    )?,
                    pubkey: pubkey_info,
                })),
                OID_NIST_P256 => Ok(Arc::new(EcdsaPrivateKey {
                    key_pair: ring::signature::EcdsaKeyPair::from_pkcs8(
                        &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
                        data.as_bytes(),
                        get_system_random(),
                    )?,
                    pubkey: pubkey_info,
                })),
                _ => Err(Error::KeyTypeNotSupported.into()),
            }
        }
        _ => Err(Error::KeyTypeNotSupported.into()),
    }
}

#[cfg(not(target_family = "wasm"))]
fn load_pkcs11_public_key(key: &str) -> Result<Vec<u8>, anyhow::Error> {
    let mut uri = PKCS11URI::from_str(key)?;
    if let Some(class) = uri.type_ {
        if class != ObjectClass::PUBLIC_KEY {
            Err(Error::ExpectedPublicKey)?
        }
    } else {
        uri.type_ = Some(ObjectClass::PUBLIC_KEY)
    }
    let mut modules = PKCS11ModuleSet::instance().lock().unwrap();
    let (context, sessions) = modules.get_or_create(uri.get_module()?)?;
    let attrs = uri.attrs();
    for slot in context.get_slots_with_initialized_token()? {
        if uri.matches_slot(slot, &context.get_slot_info(slot)?)
            && uri.matches_token(&context.get_token_info(slot)?)
        {
            let session = get_session(context, sessions, slot)?.lock().unwrap();
            login(context, &session, &uri, slot, false)?;

            for obj in session.find_objects(&attrs)? {
                return get_public_key_der(&session, obj);
            }
        }
    }
    return Err(Error::NoMatchingKey.into());
}

#[cfg(not(target_family = "wasm"))]
#[derive(Debug, Clone)]
pub struct AnyPrivateKey {
    key: Arc<dyn Signer>,
}

#[cfg(not(target_family = "wasm"))]
impl FromStr for AnyPrivateKey {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self {
            key: load_private_key(s)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AnyPublicKey {
    pub key: crate::Claim,
}

impl AnyPublicKey {
    pub fn auth_service(&self) -> AccountNumber {
        if self.key.service == AccountNumber::new(account_raw!("verify-sig")) {
            AccountNumber::new(account_raw!("auth-sig"))
        } else {
            panic!("Unknown verify service: {}", self.key.service.to_string());
        }
    }
}

impl FromStr for AnyPublicKey {
    type Err = anyhow::Error;
    fn from_str(key: &str) -> Result<Self, Self::Err> {
        #[cfg(not(target_family = "wasm"))]
        if key.starts_with("pkcs11:") {
            return Ok(Self {
                key: crate::Claim {
                    service: AccountNumber::new(account_raw!("verify-sig")),
                    rawData: load_pkcs11_public_key(key)?.into(),
                },
            });
        }

        let data = read_key_file(key, "PUBLIC KEY", Error::ExpectedPublicKey)?;

        data.decode_msg::<spki::SubjectPublicKeyInfo<AnyRef, BitStringRef>>()?;
        Ok(Self {
            key: crate::Claim {
                service: AccountNumber::new(account_raw!("verify-sig")),
                rawData: data.into_vec().into(),
            },
        })
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn sign_transaction(
    mut trx: crate::Transaction,
    keys: &[AnyPrivateKey],
) -> Result<crate::SignedTransaction, K1Error> {
    trx.claims = keys.iter().map(|k| k.key.get_claim()).collect();
    let transaction = fracpack::Pack::packed(&trx);
    let proofs = keys
        .iter()
        .map(|k| k.key.sign(&transaction).into())
        .collect();
    Ok(crate::SignedTransaction {
        transaction: transaction.into(),
        proofs,
        subjectiveData: None,
    })
}

pub fn generate_keypair() -> Result<(String, String), anyhow::Error> {
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key: &VerifyingKey = signing_key.verifying_key();

    let private_key = signing_key.to_pkcs8_pem(sec1::LineEnding::LF)?.to_string();
    let public_key = verifying_key
        .to_public_key_pem(sec1::LineEnding::LF)?
        .to_string();

    Ok((public_key, private_key))
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::pkcs8::DecodePublicKey;

    const K1_PARAMS: [u8; 7] = [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a];
    const R1_PARAMS: [u8; 10] = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

    /// n / 2 for the curve of `pubkey`
    fn half_order(pubkey: &[u8]) -> [u8; 32] {
        let mut half = group_order(pubkey).unwrap();
        let mut carry = 0u8;
        for byte in half.iter_mut() {
            let next = *byte & 1;
            *byte = (*byte >> 1) | (carry << 7);
            carry = next;
        }
        half
    }

    fn is_low_s(signature: &[u8], pubkey: &[u8]) -> bool {
        signature.len() == 64 && signature[32..] <= half_order(pubkey)[..]
    }

    /// (r, n - s): the other encoding of the same signature
    fn other_s(signature: &[u8], pubkey: &[u8]) -> Vec<u8> {
        let order = group_order(pubkey).unwrap();
        let mut result = signature.to_vec();
        let mut borrow = 0i16;
        for i in (0..32).rev() {
            let d = order[i] as i16 - signature[32 + i] as i16 - borrow;
            borrow = (d < 0) as i16;
            result[32 + i] = (d + 256 * borrow) as u8;
        }
        result
    }

    fn verify(signature: &[u8], data: &[u8], pubkey: &[u8]) {
        if pubkey.windows(K1_PARAMS.len()).any(|w| w == K1_PARAMS) {
            let digest =
                secp256k1::Message::from_hashed_data::<secp256k1::hashes::sha256::Hash>(data);
            let key = secp256k1::PublicKey::from_slice(&pubkey[pubkey.len() - 65..]).unwrap();
            let signature = secp256k1::ecdsa::Signature::from_compact(signature).unwrap();
            secp256k1::SECP256K1
                .verify_ecdsa(&digest, &signature, &key)
                .unwrap();
        } else {
            VerifyingKey::from_public_key_der(pubkey)
                .unwrap()
                .verify(data, &p256::ecdsa::Signature::from_slice(signature).unwrap())
                .unwrap();
        }
    }

    #[test]
    fn normalize_signature_picks_the_low_s_form() {
        for params in [&K1_PARAMS[..], &R1_PARAMS[..]] {
            let half = half_order(params);
            let mut above = half;
            *above.last_mut().unwrap() += 1;
            let mut one = [0u8; 32];
            one[31] = 1;
            for s in [one, half, above, [0x5a; 32], [0xa5; 32]] {
                let mut signature = vec![7u8; 32];
                signature.extend_from_slice(&s);
                let other = other_s(&signature, params);
                // Exactly one of the two encodings is low.
                assert_ne!(is_low_s(&signature, params), is_low_s(&other, params));
                let low = if is_low_s(&signature, params) {
                    signature.clone()
                } else {
                    other.clone()
                };
                assert_eq!(normalize_signature(signature, params), low);
                assert_eq!(normalize_signature(other, params), low);
            }
        }
    }

    #[test]
    fn p256_key_file_signs_low_s() {
        let (_public, private) = generate_keypair().unwrap();
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), private).unwrap();
        let signer = load_private_key(file.path().to_str().unwrap()).unwrap();
        let pubkey = signer.get_claim().rawData.0;
        for i in 0u32..128 {
            let data = i.to_le_bytes();
            let signature = signer.sign(&data);
            assert!(is_low_s(&signature, &pubkey), "message {i}");
            verify(&signature, &data, &pubkey);
        }
    }

    /// Signs with keys held by a PKCS #11 token (SoftHSM). A token returns
    /// whichever s it computed and cannot be told otherwise, so this checks
    /// that the signer normalizes afterwards.
    ///
    /// Runs when PSIBASE_TEST_SOFTHSM2 is the path of libsofthsm2.so.
    #[test]
    fn pkcs11_token_signs_low_s() {
        let Ok(module) = std::env::var("PSIBASE_TEST_SOFTHSM2") else {
            eprintln!("PSIBASE_TEST_SOFTHSM2 is not set; skipping the PKCS #11 signer test");
            return;
        };
        let util =
            std::env::var("PSIBASE_TEST_SOFTHSM2_UTIL").unwrap_or("softhsm2-util".to_string());
        const PIN: &str = "567890";

        let dir = tempfile::tempdir().unwrap();
        let tokens = dir.path().join("tokens");
        std::fs::create_dir(&tokens).unwrap();
        let conf = dir.path().join("softhsm2.conf");
        std::fs::write(
            &conf,
            format!(
                "directories.tokendir = {}\nobjectstore.backend = file\nlog.level = ERROR\n",
                tokens.display()
            ),
        )
        .unwrap();
        // Read by softhsm2-util and by the module when it is loaded below.
        std::env::set_var("SOFTHSM2_CONF", &conf);
        let status = std::process::Command::new(util)
            .args(["--init-token", "--free", "--label", "psibase-test"])
            .args(["--so-pin", "12345678", "--pin", PIN])
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());

        let keys = [("r1", &R1_PARAMS[..]), ("k1", &K1_PARAMS[..])];
        {
            let mut modules = PKCS11ModuleSet::instance().lock().unwrap();
            let (context, _) = modules.get_or_create(module.clone()).unwrap();
            let slot = context.get_slots_with_initialized_token().unwrap()[0];
            let session = context.open_rw_session(slot).unwrap();
            session
                .login(UserType::User, Some(&AuthPin::from_str(PIN).unwrap()))
                .unwrap();
            for (label, params) in keys {
                session
                    .generate_key_pair(
                        &Mechanism::EccKeyPairGen,
                        &[
                            Attribute::Token(true),
                            Attribute::Verify(true),
                            Attribute::EcParams(params.to_vec()),
                            Attribute::Id(label.into()),
                            Attribute::Label(label.into()),
                        ],
                        &[
                            Attribute::Token(true),
                            Attribute::Sign(true),
                            Attribute::Id(label.into()),
                            Attribute::Label(label.into()),
                        ],
                    )
                    .unwrap();
            }
            session.logout().unwrap();
        }

        for (label, _) in keys {
            let uri = format!(
                "pkcs11:token=psibase-test;object={label}?module-path={module}&pin-value={PIN}"
            );
            let signer = load_private_key(&uri).unwrap();
            let pubkey = signer.get_claim().rawData.0;
            for i in 0u32..64 {
                let data = i.to_le_bytes();
                let signature = signer.sign(&data);
                assert!(is_low_s(&signature, &pubkey), "{label} message {i}");
                verify(&signature, &data, &pubkey);
            }

            // What the token returns before normalization. If none of these
            // were high-S, the assertions above would not have tested anything.
            let mut modules = PKCS11ModuleSet::instance().lock().unwrap();
            let (context, sessions) = modules.get_or_create(module.clone()).unwrap();
            let slot = context.get_slots_with_initialized_token().unwrap()[0];
            let session = get_session(context, sessions, slot).unwrap().lock().unwrap();
            let key = extract_first(
                session
                    .find_objects(&[
                        Attribute::Class(ObjectClass::PRIVATE_KEY),
                        Attribute::Label(label.into()),
                    ])
                    .unwrap(),
            )
            .unwrap();
            let high = (0u32..64)
                .filter(|i| {
                    let digest = Sha256::digest(i.to_le_bytes());
                    let raw = session.sign(&Mechanism::Ecdsa, key, &digest).unwrap();
                    !is_low_s(&raw, &pubkey)
                })
                .count();
            assert!(high > 0, "{label}: the token never returned a high-S signature");
        }
    }
}
