use psibase::*;

use crate::policy::{DEVICE_COOKIE, DEVICE_RETENTION_SECS, SESSION_COOKIE};

const COOKIE_ATTRS: &str = "Path=/; SameSite=Strict; Secure; HttpOnly";

/// Outgoing HTTP response: CORS, `Set-Cookie`, and route-specific headers.
pub(crate) struct HostDbReply {
    headers: Vec<HttpHeader>,
}

impl HostDbReply {
    pub(crate) fn empty() -> Self {
        Self {
            headers: Vec::new(),
        }
    }

    pub(crate) fn allow_origin(&mut self, origin: &str) {
        self.headers.extend(cors_headers(origin));
    }

    pub(crate) fn set_device(&mut self, device: &[u8]) {
        self.headers.push(device_set_cookie(device));
    }

    pub(crate) fn set_session(&mut self, session: u32) {
        self.headers.push(session_set_cookie(session));
    }

    pub(crate) fn set_preflight(&mut self, http: &HttpRequest) {
        self.headers.extend(preflight_cors_headers(http));
    }

    pub(crate) fn set_status(&self, status: HttpStatus) -> HttpReply {
        status_reply(status, Some(self.headers.clone()))
    }

    pub(crate) fn finish_with_status(self, status: HttpStatus) -> HttpReply {
        status_reply(status, Some(self.headers))
    }

    pub(crate) fn finish_with_body(self, value: Option<Vec<u8>>) -> HttpReply {
        let mut headers = self.headers;
        headers.push(HttpHeader::new("Cache-Control", "no-store"));
        match value {
            Some(body) => body_reply(HttpStatus::Ok, body, headers),
            None => status_reply(HttpStatus::NotFound, Some(headers)),
        }
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    Hex(bytes).to_string().to_ascii_lowercase()
}

fn device_set_cookie(device: &[u8]) -> HttpHeader {
    HttpHeader::new(
        "Set-Cookie",
        &format!(
            "{DEVICE_COOKIE}={}; {COOKIE_ATTRS}; Max-Age={DEVICE_RETENTION_SECS}",
            hex_encode(device),
        ),
    )
}

fn session_set_cookie(session: u32) -> HttpHeader {
    HttpHeader::new(
        "Set-Cookie",
        &format!("{SESSION_COOKIE}={session}; {COOKIE_ATTRS}"),
    )
}

fn cors_headers(origin: &str) -> Vec<HttpHeader> {
    vec![
        HttpHeader::new("Access-Control-Allow-Origin", origin),
        HttpHeader::new("Access-Control-Allow-Credentials", "true"),
    ]
}

fn preflight_cors_headers(request: &HttpRequest) -> Vec<HttpHeader> {
    let mut headers = vec![HttpHeader::new("Access-Control-Allow-Methods", "GET, POST")];
    if let Some(requested) = request.get_header("access-control-request-headers") {
        headers.push(HttpHeader::new("Access-Control-Allow-Headers", requested));
    }
    headers
}

fn status_reply(status: HttpStatus, headers: Option<Vec<HttpHeader>>) -> HttpReply {
    HttpReply {
        status: status as u16,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: headers.unwrap_or_default(),
    }
}

fn body_reply(status: HttpStatus, body: Vec<u8>, headers: Vec<HttpHeader>) -> HttpReply {
    HttpReply {
        status: status as u16,
        contentType: "application/octet-stream".to_string(),
        body: body.into(),
        headers,
    }
}
