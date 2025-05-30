#![allow(non_snake_case)]
use crate::{AccountNumber, Checksum256, Hex};
use async_graphql::SimpleObject;
use fracpack::ToSchema;
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
type SitesContentKey = (AccountNumber, String);

// TODO: Update structs
#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "SitesContentRowInput")]
struct SitesContentRow {
    account: AccountNumber,
    path: String,
    contentType: String,
    contentHash: Checksum256,
    contentEncoding: Option<String>,
    csp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "SiteConfigRowInput")]
struct SiteConfigRow {
    account: AccountNumber,
    spa: bool,
    cache: bool,
    globalCsp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
struct SitesDataRow {
    hash: Checksum256,
    data: Hex<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[fracpack(fracpack_mod = "fracpack")]
struct SitesDataRefRow {
    hash: Checksum256,
    refs: u32,
}

/// Decompress content
///
/// `DecompressorInterface` is implemented by services that can decompress content
/// with a specific encoding.
///
/// Decompressor services should not inherit from this struct,
/// instead they should define actions with matching signatures.
///
/// The `sites` service uses decompressor services who implement this interface to
/// decompress content when the client's accepted encodings do not include the
/// content's encoding.
#[allow(dead_code)]
struct DecompressorInterface;
impl DecompressorInterface {
    /// Decompresses content compressed with some algorithm
    #[allow(dead_code, unused_variables)]
    fn decompress(content: Vec<u8>) -> Vec<u8> {
        unimplemented!()
    }
}

#[crate::service(name = "sites", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{http::HttpRequest, Checksum256, Hex};

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

    /// Stores content accessible at the caller's subdomain
    #[action]
    fn hardlink(
        path: String,
        contentType: String,
        contentEncoding: Option<String>,
        contentHash: Checksum256,
    ) {
        unimplemented!()
    }

    /// Removes content from the caller's subdomain
    #[action]
    fn remove(path: String) {
        unimplemented!()
    }

    /// Checks whether a request for content on a site at the given path is valid (such a request will not produce a 404).
    ///
    /// Note: For single-page applications, static assets (e.g. 'style.css') can be checked normally. However, all other assets
    /// are routed client-side, so a route like `/page1` is considered a valid route as long as the SPA serves a root document.
    #[action]
    fn isValidPath(site: crate::AccountNumber, path: String) -> bool {
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

    /// Deletes the Content Security Policy for the specified path (or "*" for the global CSP).
    #[action]
    fn deleteCsp(path: String) {
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
