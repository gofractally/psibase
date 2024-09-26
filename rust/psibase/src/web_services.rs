/// Interface for services which serve http
///
/// The `http-server` service uses this interface to call into other services to respond
/// to http requests.
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
    /// register your service by calling the registerServer action in the `http-server`
    /// service.
    ///
    /// `serveSys` can do any of the following:
    ///
    /// - Return `None` to signal not found. psinode produces a 404 response in this case.
    /// - Abort. psinode produces a 500 response with the service's abort message.
    /// - Return a [psibase::HttpReply](crate::HttpReply). psinode produces a 200 response with the body and contentType returned.
    /// - Call other services.
    /// - Call `http-server::sendReply`. Explicitly sends a response.
    /// - Call `http-server::deferReply`. No response will be produced until `http-server::sendReply` is called.
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
///
/// Note: most services should not implement this interface, and instead rely on the standard
/// [psibase::Sites] app to store & serve their static files. It is still possible to use this
/// interface for file storage/service outside of the Sites app, but note that the `psibase`
/// CLI tool will not work and you will need to call the `storeSys` action on your service manually.
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
    /// The `psibase upload` command calls this action on the Sites service.
    #[action]
    fn storeSys(path: String, contentType: String, content: Hex<Vec<u8>>) {
        unimplemented!()
    }
}
