use crate::{AccountNumber, Pack, Reflect, Unpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Pack, Unpack, Reflect, Serialize, Deserialize)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
pub struct InstalledPackage {
    pub name: String,
    pub depends: Vec<String>,
    pub accounts: Vec<AccountNumber>,
}

#[crate::service(name = "package-sys", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::services::package_sys::InstalledPackage;
    #[action]
    fn postinstall(package: InstalledPackage) {
        unimplemented!()
    }
}
