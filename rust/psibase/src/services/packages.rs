#[crate::service(name = "packages", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::package::Meta;
    use crate::{Checksum256, Hex};
    #[action]
    fn postinstall(package: Meta, manifest: Hex<Vec<u8>>) {
        unimplemented!()
    }

    #[action]
    fn checkOrder(id: Checksum256, index: u32) {
        unimplemented!();
    }

    #[action]
    fn removeOrder(id: Checksum256) {
        unimplemented!();
    }
}
