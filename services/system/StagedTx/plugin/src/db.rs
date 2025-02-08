use crate::bindings::*;
use clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};

pub struct CurrentSender;
impl CurrentSender {
    const KEY: &'static str = "sender";

    pub fn set(sender: Option<String>) {
        match sender {
            Some(s) => Keyvalue::set(Self::KEY, &s.packed()).expect("Failed to set sender"),
            None => Keyvalue::delete(Self::KEY),
        }
    }

    pub fn get() -> Option<String> {
        Keyvalue::get(Self::KEY).map(|a| String::unpacked(&a).expect("Failed to unpack sender"))
    }
}
