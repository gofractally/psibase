#[crate::service(name = "plugin-info", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Checksum256};

    #[action]
    fn cachePlugin(service: AccountNumber, path: String) {
        unimplemented!()
    }

    #[action]
    fn isCached(content_hash: Checksum256) -> bool {
        unimplemented!()
    }

    #[action]
    fn getPluginContentHash(service: AccountNumber, path: String) -> Option<Checksum256> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
