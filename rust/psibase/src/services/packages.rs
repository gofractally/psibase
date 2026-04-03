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
    use crate as psibase;
    use crate::package::Meta;
    use crate::{AccountNumber, Checksum256, Hex, PackageExport, PackageRef, Schema};
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "InstalledPackageTable", index = 0)]
    #[derive(
        Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, PartialEq, Eq, ToSchema,
    )]
    pub struct InstalledPackage {
        pub name: String,
        pub version: String,
        pub description: String,
        pub depends: Vec<PackageRef>,
        pub accounts: Vec<AccountNumber>,
        pub owner: AccountNumber,
        pub exports: Vec<PackageExport>,
    }

    impl InstalledPackage {
        #[primary_key]
        fn primary_key(&self) -> (String, AccountNumber) {
            (self.name.clone(), self.owner)
        }
    }

    #[table(name = "PackageManifestTable", index = 1)]
    #[derive(Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    struct PackageManifest {
        name: String,
        owner: AccountNumber,
        data: Hex<Vec<u8>>,
    }
    impl PackageManifest {
        #[primary_key]
        fn primary_key(&self) -> (String, AccountNumber) {
            (self.name.clone(), self.owner)
        }
    }

    #[table(name = "TransactionOrderTable", index = 2)]
    #[derive(Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    struct TransactionOrder {
        owner: AccountNumber,
        id: u64,
        index: u32,
    }
    impl TransactionOrder {
        #[primary_key]
        fn primary_key(&self) -> (AccountNumber, u64) {
            (self.owner, self.id)
        }
    }

    #[table(name = "InstalledSchemaTable", index = 3)]
    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    pub struct InstalledSchema {
        #[primary_key]
        pub account: AccountNumber,
        pub schema: Schema,
    }

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

pub use service::{InstalledPackage, InstalledPackageTable, InstalledSchema, InstalledSchemaTable};

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
