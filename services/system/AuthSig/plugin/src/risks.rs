use crate::bindings::permissions::plugin::types::Trust;
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref TRUST_LEVELS: HashMap<&'static str, u8> = Risks::get_trust_levels();
}

pub struct Risks;

impl Risks {
    fn get_trust_levels() -> HashMap<&'static str, u8> {
        let mut map = HashMap::new();
        map.insert("generate_keypair", 2);
        map.insert("generate_unmanaged_keypair", 0);
        map.insert("pub_from_priv", 0);
        map.insert("priv_from_pub", 5);
        map.insert("to_der", 0);
        map.insert("sign", 0); // Takes private key as input
        map.insert("import_key", 2);
        map.insert("set_key", 5);
        map
    }

    fn get_description(level: u8) -> String {
        match level {
            2 => indoc::indoc! {"
            If authorized, you grant the requesting app the following abilities:
                - Create new keypairs
                - Import existing keypairs
            "},
            5 => indoc::indoc! {"
            If authorized, you grant the requesting app the following abilities:
                - Set the public key for your account
                - Sign transactions on your behalf
                - Read the private key for a given public key
            "},
            _ => "",
        }
        .to_string()
    }

    fn get_level(fn_name: &str) -> u8 {
        *TRUST_LEVELS.get(fn_name).unwrap_or(&6)
    }

    pub fn get_trust_req(fn_name: &str) -> Trust {
        let level = Risks::get_level(fn_name);
        Trust {
            level,
            description: Risks::get_description(level),
        }
    }
}
