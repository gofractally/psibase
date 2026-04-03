#[crate::service(name = "dyn-ld", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod service {
    use crate::{self as psibase, AccountNumber};
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    pub struct DynDep {
        pub name: String,
        pub service: AccountNumber,
    }

    #[action]
    fn link(group: String, deps: Vec<DynDep>) {
        unimplemented!()
    }

    #[action]
    fn unlink(group: String) {
        unimplemented!()
    }
}

pub use service::DynDep;

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
