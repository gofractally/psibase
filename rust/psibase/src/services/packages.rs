#[crate::service(name = "packages", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::package::Meta;
    use crate::{Hex, Schema};
    #[action]
    fn postinstall(package: Meta, manifest: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn setSchema(schema: Schema) {
        unimplemented!()
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
