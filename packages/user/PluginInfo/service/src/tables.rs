#[psibase::service_tables]
pub mod tables {
    use psibase::*;

    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, Default, Serialize, Deserialize, Fracpack, ToSchema)]
    pub struct ParsedFunction {
        pub name: String,
        #[serde(rename = "dynamicLink")]
        pub dynamic_link: bool,
    }

    #[derive(Clone, Debug, Default, Serialize, Deserialize, Fracpack, ToSchema)]
    pub struct ParsedInterface {
        pub namespace: String,
        pub package: String,
        pub name: String,
        pub funcs: Vec<ParsedFunction>,
    }

    #[derive(Clone, Debug, Serialize, Deserialize, Fracpack, ToSchema)]
    pub struct ParsedFunctions {
        pub namespace: String,
        pub package: String,
        pub interfaces: Vec<ParsedInterface>,
        pub funcs: Vec<ParsedFunction>,
    }

    impl Default for ParsedFunctions {
        fn default() -> Self {
            Self {
                namespace: "root".to_string(),
                package: "component".to_string(),
                interfaces: vec![],
                funcs: vec![],
            }
        }
    }

    #[table(name = "PluginCacheTable", index = 0)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginCacheRow {
        #[primary_key]
        pub content_hash: Checksum256,
        pub imported_funcs: ParsedFunctions,
        pub exported_funcs: ParsedFunctions,
    }

    impl PluginCacheRow {
        pub fn new(
            content_hash: &Checksum256,
            imported_funcs: ParsedFunctions,
            exported_funcs: ParsedFunctions,
        ) -> Self {
            Self {
                content_hash: content_hash.clone(),
                imported_funcs,
                exported_funcs,
            }
        }
    }

    #[table(name = "PluginMappingTable", index = 1)]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginMappingRow {
        pub account: AccountNumber,
        pub path: String,
        pub content_hash: Checksum256,
    }

    impl PluginMappingRow {
        #[primary_key]
        pub fn key(&self) -> (AccountNumber, String) {
            (self.account, self.path.clone())
        }

        pub fn new(account: AccountNumber, path: String, content_hash: &Checksum256) -> Self {
            Self {
                account,
                path,
                content_hash: content_hash.clone(),
            }
        }
    }
}
