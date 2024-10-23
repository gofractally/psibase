use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::invite::plugin::advanced::InvKeys;

// Database operation wrapper
pub struct InviteKeys {}
impl InviteKeys {
    const KEY_PUB: &'static str = "pub_key";
    const KEY_PRV: &'static str = "prv_key";

    pub fn add(keys: &InvKeys) {
        Keyvalue::set(Self::KEY_PUB, &keys.pub_key).expect("Failed to set pub key");
        Keyvalue::set(Self::KEY_PRV, &keys.priv_key).expect("Failed to set priv key");
    }

    pub fn delete() {
        Keyvalue::delete(Self::KEY_PUB);
        Keyvalue::delete(Self::KEY_PRV);
    }

    pub fn get_public_key() -> Vec<u8> {
        Keyvalue::get(Self::KEY_PUB).expect("Failed to get pub key")
    }

    pub fn get_private_key() -> Vec<u8> {
        Keyvalue::get(Self::KEY_PRV).expect("Failed to get priv key")
    }
}
