#![allow(non_snake_case)]
use crate::AccountNumber;
use async_graphql::SimpleObject;
use fracpack::ToSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "SitesContentKeyInput")]
struct SitesContentKey {
    account: AccountNumber,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "InviteRecordInput")]
struct SitesContentRow {
    account: AccountNumber,
    path: String,
    contentType: String,
    content: Vec<u8>,
    csp: String,
    hash: u64,
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "SiteConfigRowInput")]
struct SiteConfigRow {
    account: AccountNumber,
    spa: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "GlobalCspRowInput")]
struct GlobalCspRow {
    account: AccountNumber,
    csp: String,
}

#[crate::service(name = "sites", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, Hex};

    /// Serves a request by looking up the content uploaded to the specified subdomain
    #[action]
    fn serveSys(request: HttpRequest) -> Option<crate::http::HttpReply> {
        unimplemented!()
    }

    /// Stores content accessible at the caller's subdomain
    #[action]
    fn storeSys(
        path: String,
        contentType: String,
        contentEncoding: Option<String>,
        content: Hex<Vec<u8>>,
    ) {
        unimplemented!()
    }

    /// Removes content from the caller's subdomain
    #[action]
    fn removeSys(path: String) {
        unimplemented!()
    }

    /// Enables/disables single-page application mode.
    /// When enabled, all content requests return the root document.
    #[action]
    fn enableSpa(enable: bool) {
        unimplemented!()
    }

    /// Sets the Content Security Policy for the specified path (or "*" for a global CSP).
    /// If a specific CSP is set, it takes precedence over the global CSP.
    /// If no specific or global CSP is set, a default CSP is used.
    #[action]
    fn setCsp(path: String, csp: String) {
        unimplemented!()
    }

    /// Enables/disables caching of responses (Enabled by default)
    /// Cache strategy:
    /// - `If-None-Match` header is checked against the hash of the content
    /// - The hash is stored in the `ETag` header
    /// - If the hash matches, a 304 Not Modified response is returned
    /// - If the hash does not match, the new content is returned with an updated `ETag` header
    #[action]
    fn enableCache(enable: bool) {
        unimplemented!()
    }
}
