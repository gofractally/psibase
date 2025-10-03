#[crate::service(name = "x-db", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
mod service {
    use crate::{DbId, Hex};
    #[action]
    fn open(db: DbId, prefix: Hex<Vec<u8>>, mode: u8) -> u32 {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
