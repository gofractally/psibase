#[crate::service(name = "x-wsauth", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, HttpReply, HttpRequest};
    use fracpack::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[action]
    fn serveSys(request: HttpRequest, socket: Option<i32>) -> Option<HttpReply> {
        unimplemented!()
    }

    /// Redeems a ticket minted for the sender.
    ///
    /// Returns the user and app, or None if the ticket is missing,
    /// expired, or was minted for another service. A redeemed ticket
    /// cannot be used again.
    #[action]
    fn consume(ticket: String) -> Option<WsTicketInfo> {
        unimplemented!()
    }

    #[derive(Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    #[fracpack(fracpack_mod = "fracpack")]
    pub struct WsTicketInfo {
        pub user: AccountNumber,
        pub app: AccountNumber,
    }
}

pub const SUBPROTOCOL_PREFIX: &str = "psibase.ws-ticket.";

pub fn get_ticket(request: &crate::HttpRequest) -> Option<String> {
    request
        .headers
        .iter()
        .filter(|header| header.matches("Sec-WebSocket-Protocol"))
        .flat_map(|header| header.value.split(','))
        .find_map(|protocol| protocol.trim().strip_prefix(SUBPROTOCOL_PREFIX))
        .map(str::to_string)
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
