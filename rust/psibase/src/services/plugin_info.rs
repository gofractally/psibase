#![allow(non_snake_case)]

#[crate::service(name = "plugin-info", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod service {
    use crate::fracpack::{Pack, ToSchema, Unpack};
    use crate::{AccountNumber, Checksum256};
    use async_graphql::SimpleObject;
    use serde::{Deserialize, Serialize};

    #[derive(
        Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, ToSchema, SimpleObject,
    )]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct ParsedFunction {
        pub name: String,
        #[serde(rename = "dynamicLink")]
        pub dynamic_link: bool,
    }

    #[derive(
        Debug, Clone, Default, Serialize, Deserialize, Pack, Unpack, ToSchema, SimpleObject,
    )]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct ParsedInterface {
        pub namespace: String,
        pub package: String,
        pub name: String,
        pub funcs: Vec<ParsedFunction>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema, SimpleObject)]
    #[fracpack(fracpack_mod = "fracpack")]
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
    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct PluginCacheRow {
        #[primary_key]
        pub content_hash: Checksum256,
        pub imported_funcs: ParsedFunctions,
        pub exported_funcs: ParsedFunctions,
    }

    #[table(name = "PluginMappingTable", index = 1)]
    #[derive(Debug, Clone, Serialize, Deserialize, Pack, Unpack, ToSchema)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct PluginMappingRow {
        pub account: AccountNumber,
        pub path: String,
        pub content_hash: Checksum256,
    }

    impl PluginMappingRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String) {
            (self.account, self.path.clone())
        }
    }

    #[action]
    fn cachePlugin(service: AccountNumber, path: String) {
        unimplemented!()
    }

    #[action]
    fn getPluginCache(content_hash: Checksum256) -> Option<PluginCacheRow> {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
