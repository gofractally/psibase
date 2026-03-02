#[psibase::service_tables]
pub mod tables {
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[derive(
        Clone, Default, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema,
    )]
    pub struct ParsedFunction {
        pub name: String,
        #[serde(rename = "dynamicLink")]
        pub dynamic_link: bool,
    }

    #[derive(
        Clone, Default, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema,
    )]
    pub struct ParsedInterface {
        pub namespace: String,
        pub package: String,
        pub name: String,
        pub funcs: Vec<ParsedFunction>,
    }

    #[derive(Clone, serde::Serialize, serde::Deserialize, psibase::Fracpack, psibase::ToSchema)]
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

    #[table(name = "PluginCacheTable", index = 0, db = "Subjective")]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginCacheRow {
        #[primary_key]
        pub content_hash: psibase::Checksum256,
        pub imported_funcs: ParsedFunctions,
        pub exported_funcs: ParsedFunctions,
    }

    #[table(name = "PluginMappingTable", index = 1, db = "Subjective")]
    #[derive(Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct PluginMappingRow {
        #[primary_key]
        pub key: (psibase::AccountNumber, String),
        pub content_hash: psibase::Checksum256,
    }
}
