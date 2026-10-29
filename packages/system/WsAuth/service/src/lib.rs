use crate::tables::WsTicketTable;
use psibase::services::http_server;
use psibase::{
    abort_message, get_sender, native_raw, AccountNumber, HttpHeader, HttpReply, HttpRequest, Table,
};

const TICKET_LIFETIME_US: i64 = 60_000_000;
const CLOCK_MONOTONIC: u32 = 1;
const MAX_EXPIRED_TICKET_ERASE_PER_MINT: usize = 32;

#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber, Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "WsTicketTable", index = 0, db = "Session")]
    #[derive(Pack, Unpack, Serialize, Deserialize, ToSchema, Debug)]
    pub struct WsTicketRow {
        #[primary_key]
        pub ticket: String,
        pub user: AccountNumber,
        pub app: AccountNumber,
        pub service: AccountNumber,
        pub path: String,
        pub expiration: i64,
    }

    impl WsTicketRow {
        #[secondary_key(1)]
        fn by_expiration(&self) -> (i64, String) {
            (self.expiration, self.ticket.clone())
        }
    }
}

#[psibase::service(name = "wsauth", tables = "tables")]
#[allow(non_snake_case)]
mod service {
    use super::*;
    use crate::tables::WsTicketRow;
    use psibase::{Pack, ServiceWrapper, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Pack, Unpack, ToSchema, Serialize, Deserialize)]
    pub struct WsTicketInfo {
        pub user: AccountNumber,
        pub app: AccountNumber,
        pub path: String,
    }

    #[derive(Deserialize)]
    struct MintRequest {
        app: AccountNumber,
        service: AccountNumber,
        path: String,
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        let _ = socket;
        if get_sender() != http_server::SERVICE {
            abort_message("Wrong sender");
        }
        if request.path() != "/ws-ticket" {
            return None;
        }
        if request.method == "OPTIONS" {
            return Some(HttpReply {
                status: 204,
                headers: cors_headers(&request),
                ..Default::default()
            });
        }
        if request.method != "POST" {
            return Some(text_reply(&request, 405, "Method not allowed\n"));
        }
        if request.contentType != "application/json" {
            return Some(text_reply(
                &request,
                415,
                "Content-Type must be application/json\n",
            ));
        }

        let Some(user) = user else {
            return Some(text_reply(&request, 401, "Not authenticated\n"));
        };
        let Ok(body) = serde_json::from_slice::<MintRequest>(&request.body.0) else {
            return Some(text_reply(
                &request,
                400,
                "expected JSON {\"app\",\"service\",\"path\"}\n",
            ));
        };
        if body.path.is_empty() || !body.path.starts_with('/') {
            return Some(text_reply(
                &request,
                400,
                "path must be a non-empty absolute path\n",
            ));
        }
        let ticket = random_ticket();
        let now = monotonic_us();
        let _ = psibase::try_subjective_tx! {
            erase_expired(now);
        };
        let expiration = now + TICKET_LIFETIME_US;
        let path = body.path;
        psibase::subjective_tx! {
            WsTicketTable::new()
                .put(&WsTicketRow {
                    ticket: ticket.clone(),
                    user,
                    app: body.app,
                    service: body.service,
                    path: path.clone(),
                    expiration,
                })
                .unwrap();
        }

        let json = serde_json::json!({ "ticket": ticket }).to_string();
        Some(HttpReply {
            status: 200,
            contentType: "application/json".into(),
            body: json.into_bytes().into(),
            headers: cors_headers(&request),
        })
    }

    #[action]
    fn consume(ticket: String) -> Option<WsTicketInfo> {
        let sender = get_sender();
        let now = monotonic_us();
        psibase::subjective_tx! {
            let table = WsTicketTable::new();
            match table.get_index_pk().get(&ticket) {
                Some(row) if row.service == sender => {
                    table.remove(&row);
                    if row.expiration <= now {
                        None
                    } else {
                        Some(WsTicketInfo {
                            user: row.user,
                            app: row.app,
                            path: row.path,
                        })
                    }
                }
                _ => None,
            }
        }
    }
}

fn cors_headers(request: &HttpRequest) -> Vec<HttpHeader> {
    let mut headers = psibase::allow_cors_for_account(
        request,
        AccountNumber::from_exact("supervisor").unwrap(),
        true,
    );
    for header in &mut headers {
        if header.matches("Access-Control-Allow-Headers") {
            header.value = "Content-Type, Authorization".into();
        }
    }
    headers
}

fn text_reply(request: &HttpRequest, status: u16, message: &str) -> HttpReply {
    HttpReply {
        status,
        contentType: "text/html".into(),
        body: message.as_bytes().to_vec().into(),
        headers: cors_headers(request),
    }
}

fn random_ticket() -> String {
    let mut bytes = [0u8; 16];
    unsafe { native_raw::getRandom(bytes.as_mut_ptr(), bytes.len()) };
    hex::encode(bytes)
}

fn monotonic_us() -> i64 {
    let mut nanos = 0u64;
    let rc = unsafe { native_raw::clockTimeGet(CLOCK_MONOTONIC, &mut nanos) };
    if rc != 0 {
        abort_message("clockTimeGet failed");
    }
    (nanos / 1000) as i64
}

fn erase_expired(now: i64) {
    let table = WsTicketTable::new();
    let index = table.get_index_by_expiration();
    for row in index.iter().take(MAX_EXPIRED_TICKET_ERASE_PER_MINT) {
        if row.expiration > now {
            break;
        }
        table.remove(&row);
    }
}

#[cfg(test)]
mod tests;
