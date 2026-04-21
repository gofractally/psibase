// TODO: tables

use crate as psibase;
use crate::{account, AccountNumber};

pub const COMMON_API_SERVICE: AccountNumber = account!("common-api");
pub const HOMEPAGE_SERVICE: AccountNumber = account!("homepage");

#[crate::service(name = "http-server", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Action, Hex, HttpReply, HttpRequest};

    #[action]
    fn sendProds(action: Action) {
        unimplemented!()
    }

    /// Indicates that the query is not expected to produce an immediate response
    /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
    #[action]
    fn deferReply(socket: i32) {
        unimplemented!()
    }

    /// Indicates that a reply will be produced by the current transaction/query/callback
    /// Can be called inside `PSIBASE_SUBJECTIVE_TX`
    #[action]
    fn claimReply(socket: i32) {
        unimplemented!()
    }

    /// Sends a reply
    #[action]
    fn sendReply(socket: i32, response: HttpReply) {
        unimplemented!()
    }

    /// Allow another service to send a response to a socket
    ///
    /// The sender must be the current owner of the socket. As long as
    /// `service` does not handle the request, `giveSocket` can be
    /// reversed with `takeSocket`
    #[action]
    fn giveSocket(socket: i32, service: AccountNumber) {
        unimplemented!()
    }

    /// Take back ownership of a socket
    ///
    /// The socket must have been previously owned by the sender and
    /// neither `sendReply` nor `deferReplay` can have been called on it.
    ///
    /// Returns true if taking ownership was successful
    #[action]
    fn takeSocket(socket: i32) -> bool {
        unimplemented!()
    }

    /// Register sender's subdomain
    ///
    /// After any subdomain redirect (see `setRedirect`) and `/common/` paths are handled,
    /// `http-server` calls the registered server's `serveSys`. If there is no registered server,
    /// the request is forwarded to `sites` for static hosting.
    ///
    /// Registered services may optionally:
    /// * Serve files via HTTP
    /// * Respond to RPC requests
    /// * Respond to GraphQL requests
    #[action]
    fn registerServer(server: AccountNumber) {
        unimplemented!()
    }

    /// Entry point for messages
    #[action]
    fn recv(socket: i32, data: Hex<Vec<u8>>, flags: u32) {
        unimplemented!()
    }
    /// Entry point for HTTP requests
    #[action]
    fn serve(socket: i32, req: HttpRequest) {
        unimplemented!()
    }

    /// Returns the root host for a given host
    #[action]
    fn rootHost(host: String) -> String {
        unimplemented!()
    }

    /// Constructs a URL for a sibling subdomain under the same root host.
    /// If `keepTarget` is true, the original path and query are preserved;
    /// otherwise the URL points to the subdomain root.
    #[action]
    fn getSiblingUrl(
        req: HttpRequest,
        socket: Option<i32>,
        destination: AccountNumber,
        keepTarget: bool,
    ) -> String {
        unimplemented!()
    }

    /// Configures the sender's subdomain to permanently redirect (HTTP 308) all
    /// requests to the `destination` subdomain under the same root host. `Location`
    /// URL preserves the original path and query.
    ///
    /// Precedence:
    ///   * Requests whose path starts with `/common/` are handled immediately by `common-api`.
    ///   * All other requests are redirected to the `destination` subdomain (if configured)
    ///     before any routing to the registered server (if any) or to `sites` for static content.
    ///
    /// A caller may not redirect to its own subdomain.
    #[action]
    fn setRedirect(destination: AccountNumber) {
        unimplemented!()
    }

    /// Removes the redirect set with `setRedirect`. No-op if none is set.
    #[action]
    fn clearRedirect() {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
