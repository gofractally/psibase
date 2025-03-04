#[allow(warnings)]
mod bindings;
use bindings::*;

use exports::rand::plugin::api::Guest as Api;
use rand::Rng;

struct RandPlugin;
impl Api for RandPlugin {
    fn rand_bytes(nr_bytes: u32) -> Vec<u8> {
        let mut result = vec![0u8; nr_bytes as usize];
        let mut rng = rand::rng();
        rng.fill(&mut result[..]);
        result
    }

    fn rand_u32() -> u32 {
        rand::rng().random()
    }
}

bindings::export!(RandPlugin with_types_in bindings);
