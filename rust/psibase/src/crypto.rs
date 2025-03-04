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
        let algid = spki::AlgorithmIdentifier {
            oid: OID_ECDSA,
            parameters: Some(OID_SECP256K1),
        };
        let pubkey =
            secp256k1::PublicKey::from_secret_key(secp256k1::SECP256K1, &self.key).serialize();
        let keydata = Encode::to_der(&SubjectPublicKeyInfo {
            algorithm: algid,
            subject_public_key: BitStringRef::from_bytes(&pubkey).unwrap(),
        })
        .unwrap();
        crate::Claim {
            service: AccountNumber::new(account_raw!("verify-sig")),
            rawData: crate::Hex::from(keydata),
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
        self.key_pair
            .sign(get_system_random(), data)
            .expect("Failed to sign")
            .as_ref()
            .to_vec()
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
        session.sign(&Mechanism::Ecdsa, self.key, &digest).unwrap()
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
        (OID_ECDSA, Some(OID_SECP256K1)) => Ok(Arc::new(PKCS8PrivateKeyK1 {
            key: secp256k1::SecretKey::from_slice(
                sec1::EcPrivateKey::from_der(pkcs8_key.private_key)?.private_key,
            )?,
        })),
        (OID_ECDSA, Some(OID_NIST_P256)) => {
            let algid = spki::AlgorithmIdentifier {
                oid: OID_ECDSA,
                parameters: Some(OID_NIST_P256),
            };
            let pubkey = sec1::EcPrivateKey::from_der(pkcs8_key.private_key)?.public_key;
            let pubkey_info = Encode::to_der(&SubjectPublicKeyInfo {
                algorithm: algid,
                subject_public_key: BitStringRef::from_bytes(
                    &pubkey.ok_or(Error::PublicKeyRequired)?,
                )?,
            })?;
            Ok(Arc::new(EcdsaPrivateKey {
                key_pair: ring::signature::EcdsaKeyPair::from_pkcs8(
                    &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
                    data.as_bytes(),
                    get_system_random(),
                )?,
                pubkey: pubkey_info,
            }))
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
    })
}
