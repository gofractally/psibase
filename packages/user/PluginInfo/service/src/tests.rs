#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::service::Wrapper;
    use psibase::{account, services::http_server, Chain, Checksum256};

    #[psibase::test_case(packages("PluginInfo", "Base64"))]
    fn test_base64_deps(chain: Chain) -> Result<(), psibase::Error> {
        psibase::services::setcode::Wrapper::push(&chain)
            .setFlags(Wrapper::SERVICE, psibase::CodeRow::IS_PRIVILEGED)
            .get()?;
        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(Wrapper::SERVICE)
            .get()?;
        chain.finish_block();

        let reply = chain.get(
            account!("common-api"),
            "/common/plugin-deps?p=base64:plugin",
        )?;

        let body: serde_json::Value = serde_json::from_slice(&reply.body.0)?;
        let plugins = &body["plugins"];

        assert!(
            plugins["base64:plugin"].is_object(),
            "base64:plugin should be present"
        );

        let deps = &plugins["base64:plugin"]["deps"];
        let deps_arr = deps.as_array().unwrap();
        assert!(
            deps_arr.iter().any(|d| d == "host:types"),
            "base64 should depend on host:types"
        );
        assert!(
            deps_arr.iter().any(|d| d == "host:common"),
            "base64 should depend on host:common"
        );

        let exports = &plugins["base64:plugin"]["exportedFuncs"]["interfaces"];
        let export_names: Vec<&str> = exports
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap())
            .collect();
        assert!(export_names.contains(&"url"), "exports should contain url");
        assert!(
            export_names.contains(&"standard"),
            "exports should contain standard"
        );

        Ok(())
    }

    #[psibase::test_case(packages("PluginInfo", "Base64"))]
    fn test_cache_populated(chain: Chain) -> Result<(), psibase::Error> {
        psibase::services::setcode::Wrapper::push(&chain)
            .setFlags(Wrapper::SERVICE, psibase::CodeRow::IS_PRIVILEGED)
            .get()?;
        http_server::Wrapper::push_from(&chain, Wrapper::SERVICE)
            .registerServer(Wrapper::SERVICE)
            .get()?;
        chain.finish_block();

        let content_hash = Wrapper::push(&chain)
            .getPluginContentHash(account!("base64"), "/plugin.wasm".to_string())
            .get()?;
        let content_hash = content_hash.expect("base64 plugin should exist in Sites");

        assert!(
            Wrapper::push(&chain).isCached(content_hash).get()?,
            "cache should be populated during install"
        );

        assert!(
            !Wrapper::push(&chain)
                .isCached(Checksum256::default())
                .get()?,
            "arbitrary hash should not have a cache entry"
        );

        Ok(())
    }
}
