use crate::{Pack, ToSchema, Unpack};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct PackageSource {
    pub url: Option<String>,
    pub account: Option<crate::AccountNumber>,
}

#[crate::service(name = "packages", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::PackageSource;
    use crate::package::Meta;
    use crate::{Checksum256, Hex, Schema};

    #[action]
    fn postinstall(package: Meta, manifest: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn setSchema(schema: Schema) {
        unimplemented!()
    }

    #[action]
    fn setSources(sources: Vec<PackageSource>) {
        unimplemented!()
    }

    #[action]
    fn publish(package: Meta, sha256: Checksum256, file: String) {
        unimplemented!();
    }

    #[action]
    fn checkOrder(id: u64, index: u32) {
        unimplemented!();
    }

    #[action]
    fn removeOrder(id: u64) {
        unimplemented!();
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
