#![allow(non_snake_case)]
use crate::AccountNumber;

#[allow(dead_code)]
type SitesContentKey = (AccountNumber, String);
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
pub mod service {
    use crate::fracpack::{Pack, ToSchema, Unpack};
    use crate::{http::HttpRequest, AccountNumber, Checksum256, Hex};
    use async_graphql::SimpleObject;
    use serde::{Deserialize, Serialize};

    #[table(name = "SitesContentTable", index = 0)]
    #[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema, Pack, Unpack)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SitesContentRow {
        pub account: AccountNumber,
        pub path: String,
        pub contentType: String,
        pub contentHash: Checksum256,
        pub contentEncoding: Option<String>,
        pub csp: Option<String>,
    }

    impl SitesContentRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, String) {
            (self.account, self.path.clone())
        }
    }

    #[table(name = "SiteConfigTable", index = 1)]
    #[derive(Debug, Clone, Serialize, Deserialize, SimpleObject, ToSchema, Pack, Unpack)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SiteConfigRow {
        #[primary_key]
        pub account: AccountNumber,
        pub spa: bool,
        pub cache: bool,
        pub globalCsp: Option<String>,
    }

    #[table(name = "SitesDataTable", index = 2)]
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Pack, Unpack)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SitesDataRow {
        #[primary_key]
        pub hash: Checksum256,
        pub data: Vec<u8>,
    }

    #[table(name = "SitesDataRefTable", index = 3)]
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Pack, Unpack)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct SitesDataRefRow {
        #[primary_key]
        pub hash: Checksum256,
        pub refs: u32,
    }

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

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
