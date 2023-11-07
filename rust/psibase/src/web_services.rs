/// Interface for services which serve http
///
/// [proxy.sys](https://doc-sys.psibase.io/default-apps/proxy-sys.html) uses this
/// interface to call into services to respond to http requests.
///
/// To implement this interface, add a [serveSys](ServerActions::serveSys) action to
/// your service.
#[crate::service(
    name = "example-server",
    actions = "ServerActions",
    wrapper = "ServerWrapper",
    structs = "server_action_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod server_interface {
    use crate::*;

    /// Handle HTTP requests
    ///
    /// Define this action in your service to handle HTTP requests. You'll also need to
    /// [register your service](https://doc-sys.psibase.io/services/rust-service/reference/web-services.html#registration).
    ///
    /// `serveSys` can do any of the following:
    ///
    /// - Return `None` to signal not found. psinode produces a 404 response in this case.
    /// - Abort. psinode produces a 500 response with the service's abort message.
    /// - Return a [psibase::HttpReply](crate::HttpReply). psinode produces a 200 response with the body and contentType returned.
    /// - Call other services.
    ///
    /// A service runs in RPC mode while serving an HTTP request. This mode prevents database writes,
    /// but allows database reads, including reading data and events which are normally not available
    /// to services; see [psibase::DbId](crate::DbId).
    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        unimplemented!()
    }
}

/// Interface for services which support storing files
///
/// Some services support storing files which they then serve via HTTP.
/// This is the standard interface for these services.
///
/// To implement this interface, add a [storeSys](StorageActions::storeSys)
/// action to your service.
#[crate::service(
    name = "example-store",
    actions = "StorageActions",
    wrapper = "StorageWrapper",
    structs = "storage_action_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod storage_interface {
    use crate::Hex;

    /// Store a file
    ///
    /// Define this action in your service to handle file storage requests. This action
    /// should store the file in the service's tables. The service can then serve these
    /// files via HTTP.
    ///
    /// - `path`: absolute path to file. e.g. `/index.html` for the main page
    /// - `contentType`: `text/html`, `text/javascript`, `application/octet-stream`, ...
    /// - `content`: file content
    ///
    /// The `psibase upload` command uses this action.
    ///
    /// (TODO) simplifies implementing this.
    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }
}
