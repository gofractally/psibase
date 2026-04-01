#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::parse::parse_component;
    use crate::service::Wrapper;
    use psibase::services::sites::service::Wrapper as SitesWrapper;
    use psibase::{account, anyhow, Chain};
    use serde_json::Value;

    fn get_hash(chain: &Chain, account: &str, path: &str) -> Result<String, psibase::Error> {
        let q = format!(
            r#"query {{
                getContentAt(account: "{}", path: "{}") {{
                    contentHash
                }}
            }}"#,
            account, path
        );
        let reply: Value = chain.graphql(SitesWrapper::SERVICE, &q)?;
        let hash_str = reply["data"]["getContentAt"]["contentHash"]
            .as_str()
            .ok_or_else(|| {
                anyhow!("missing content from Sites getContentAt for account={account} path={path}")
            })?;
        Ok(hash_str.to_string())
    }

    fn is_cached(chain: &Chain, hash_str: &str) -> Result<bool, psibase::Error> {
        let q = format!(r#"query {{ isCached(contentHash: "{hash_str}") }}"#);
        let reply: Value = chain.graphql(Wrapper::SERVICE, &q)?;
        let cached = reply["data"]["isCached"].as_bool().unwrap();
        Ok(cached)
    }

    #[test]
    fn test_component_parsing() {
        const BYTES: &[u8] = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../build/components/transact.wasm"
        ));
        let (imported, exported) = parse_component(account!("transact"), "/plugin.wasm", BYTES);
        assert!(
            !imported.interfaces.is_empty()
                || !exported.interfaces.is_empty()
                || !imported.funcs.is_empty()
                || !exported.funcs.is_empty(),
            "expected non-empty parse result for transact component"
        );
    }

    #[psibase::test_case(packages("Base64", "PluginInfo"))]
    fn test_cache_population(chain: Chain) -> Result<(), psibase::Error> {
        chain.finish_block();

        assert_eq!(
            is_cached(
                &chain,
                "0000000000000000000000000000000000000000000000000000000000000000"
            )?,
            false,
            "invalid hash should not have a cache entry"
        );

        let hash_str = get_hash(&chain, "base64", "/plugin.wasm")?;
        assert_eq!(
            is_cached(&chain, &hash_str)?,
            true,
            "cache should be populated for base64 plugin"
        );

        Ok(())
    }

    // #[psibase::test_case(packages("PluginInfo", "Base64"))]
    // fn test_base64_deps(chain: Chain) -> Result<(), psibase::Error> {
    //     psibase::services::setcode::Wrapper::push(&chain)
    //         .setFlags(Wrapper::SERVICE, psibase::CodeRow::IS_PRIVILEGED)
    //         .get()?;
    //     http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
    //         .registerServer(Wrapper::SERVICE)
    //         .get()?;
    //     chain.finish_block();

    //     let reply = chain.get(
    //         account!("common-api"),
    //         "/common/plugin-deps?p=base64:plugin",
    //     )?;

    //     let body: serde_json::Value = serde_json::from_slice(&reply.body.0)?;
    //     let plugins = &body["plugins"];

    //     assert!(
    //         plugins["base64:plugin"].is_object(),
    //         "base64:plugin should be present"
    //     );

    //     let deps = &plugins["base64:plugin"]["deps"];
    //     let deps_arr = deps.as_array().unwrap();
    //     assert!(
    //         deps_arr.iter().any(|d| d == "host:types"),
    //         "base64 should depend on host:types"
    //     );
    //     assert!(
    //         deps_arr.iter().any(|d| d == "host:common"),
    //         "base64 should depend on host:common"
    //     );

    //     let exports = &plugins["base64:plugin"]["exportedFuncs"]["interfaces"];
    //     let export_names: Vec<&str> = exports
    //         .as_array()
    //         .unwrap()
    //         .iter()
    //         .map(|e| e["name"].as_str().unwrap())
    //         .collect();
    //     assert!(export_names.contains(&"url"), "exports should contain url");
    //     assert!(
    //         export_names.contains(&"standard"),
    //         "exports should contain standard"
    //     );

    //     Ok(())
    // }
}
