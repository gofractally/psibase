use psibase::*;

use super::constants::{DEVICE_COOKIE, DEVICE_MAX_AGE_SECS, SESSION_COOKIE};

pub(crate) fn status_reply(status: u16) -> HttpReply {
    HttpReply {
        status,
        contentType: String::new(),
        body: Vec::new().into(),
        headers: Vec::new(),
    }
}

pub(crate) fn reply(
    request: &HttpRequest,
    origin: &str,
    status: u16,
    body: Option<Vec<u8>>,
    device_cookie: Option<String>,
    session_cookie: Option<String>,
) -> HttpReply {
    let content_type = if body.is_some() {
        "application/octet-stream"
    } else {
        ""
    };
    // CORS preflight headers only when OPTIONS returns 204.
    let preflight = request.method == "OPTIONS" && status == 204;
    let mut headers = vec![
        HttpHeader::new("Access-Control-Allow-Origin", origin),
        HttpHeader::new("Access-Control-Allow-Credentials", "true"),
    ];
    if preflight {
        headers.push(HttpHeader::new("Access-Control-Allow-Methods", "GET, POST"));
        if let Some(requested) = request.get_header("access-control-request-headers") {
            headers.push(HttpHeader::new("Access-Control-Allow-Headers", requested));
        }
    }
    if let Some(cookie) = device_cookie {
        headers.push(HttpHeader::new(
            "Set-Cookie",
            &format!(
                "{DEVICE_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; Max-Age={DEVICE_MAX_AGE_SECS}; HttpOnly;"
            ),
        ));
    }
    if let Some(cookie) = session_cookie {
        headers.push(HttpHeader::new(
            "Set-Cookie",
            &format!("{SESSION_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; HttpOnly;"),
        ));
    }
    HttpReply {
        status,
        contentType: content_type.to_string(),
        body: body.unwrap_or_default().into(),
        headers,
    }
}
