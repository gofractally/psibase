/// Persistent `host:db` storage on `hostdb.{root}`.
///
/// `GET /kv/persistent/<key>` returns the raw value (`application/octet-stream`),
/// or 404 when it is absent. `POST /kv/batch` applies
/// `{"ops":[{"duration":"persistent","key":<hex>,"value":<base64url>|null}]}`
/// in one subjective transaction and returns 204; a null value deletes the key.
/// An invalid op returns 400 and writes nothing. `OPTIONS` on these paths is the
/// CORS preflight. Only `Origin: supervisor.{root}` is accepted. The device id is
/// the `__Host-HOSTDB-DEVICE` cookie.
#[psibase::service_tables]
mod tables {
    use psibase::{Pack, ToSchema, Unpack};

    #[table(name = "KvTable", index = 0, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct KvRow {
        pub device: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
    }

    impl KvRow {
        #[primary_key]
        fn by_device_key(&self) -> (Vec<u8>, Vec<u8>) {
            (self.device.clone(), self.key.clone())
        }
    }
}

#[psibase::service(name = "hostdb", tables = "tables")]
mod service {
    use crate::tables::{KvRow, KvTable};
    use psibase::native_raw;
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::*;
    use serde::Deserialize;

    const DEVICE_COOKIE: &str = "__Host-HOSTDB-DEVICE";
    const DEVICE_ID_LEN: usize = 16;
    const KEY_LEN: usize = 32;
    /// 100 KB plaintext plus the 12-byte nonce and 16-byte GCM tag `host:db` stores.
    const MAX_VALUE_LEN: usize = 100 * 1024 + 28;
    const COOKIE_MAX_AGE: u64 = 400 * 24 * 60 * 60;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct BatchBody {
        ops: Vec<BatchOp>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct BatchOp {
        duration: String,
        key: String,
        value: Option<String>,
    }

    enum Change {
        Put { key: Vec<u8>, value: Vec<u8> },
        Delete { key: Vec<u8> },
    }

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        let root = HttpServer::call().rootHost(request.host.clone());
        let Some(origin) = request.get_header("origin") else {
            return Some(status_reply(403));
        };
        if !is_supervisor_origin(origin, &root) {
            return Some(status_reply(403));
        }

        let device = match device_from_request(&request) {
            Device::Id(id) => id,
            Device::Missing => mint_device_id(),
            Device::Malformed => {
                return Some(reply(&request, origin, 400, "", Vec::new(), false, None));
            }
        };
        let cookie = hex_encode(&device);

        let path = request.path();
        let path = path.as_ref();
        if request.method == "OPTIONS" && is_storage_path(path) {
            return Some(reply(
                &request,
                origin,
                204,
                "",
                Vec::new(),
                true,
                Some(cookie),
            ));
        }

        if request.method == "GET" {
            if let Some(key) = path.strip_prefix("/kv/persistent/") {
                let Some(key) = decode_fixed_hex(key, KEY_LEN) else {
                    return Some(reply(
                        &request,
                        origin,
                        400,
                        "",
                        Vec::new(),
                        false,
                        Some(cookie),
                    ));
                };
                let value = {
                    subjective_tx! {
                        KvTable::new()
                            .get_index_pk()
                            .get(&(device.clone(), key.clone()))
                            .map(|row| row.value)
                    }
                };
                return Some(match value {
                    Some(value) => reply(
                        &request,
                        origin,
                        200,
                        "application/octet-stream",
                        value,
                        false,
                        Some(cookie),
                    ),
                    None => reply(&request, origin, 404, "", Vec::new(), false, Some(cookie)),
                });
            }
        }

        if request.method == "POST" && path == "/kv/batch" {
            let Some(changes) = parse_batch(&request.body.0) else {
                return Some(reply(
                    &request,
                    origin,
                    400,
                    "",
                    Vec::new(),
                    false,
                    Some(cookie),
                ));
            };
            subjective_tx! {
                let table = KvTable::new();
                for change in &changes {
                    match change {
                        Change::Put { key, value } => {
                            table
                                .put(&KvRow {
                                    device: device.clone(),
                                    key: key.clone(),
                                    value: value.clone(),
                                })
                                .unwrap();
                        }
                        Change::Delete { key } => {
                            table.erase(&(device.clone(), key.clone()));
                        }
                    }
                }
            }
            return Some(reply(
                &request,
                origin,
                204,
                "",
                Vec::new(),
                false,
                Some(cookie),
            ));
        }

        Some(reply(
            &request,
            origin,
            404,
            "",
            Vec::new(),
            false,
            Some(cookie),
        ))
    }

    fn is_storage_path(path: &str) -> bool {
        path == "/kv/batch" || path.starts_with("/kv/persistent/")
    }

    fn is_supervisor_origin(origin: &str, root: &str) -> bool {
        let Some(rest) = origin
            .strip_prefix("https://")
            .or(origin.strip_prefix("http://"))
        else {
            return false;
        };
        let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
        let host = match host.rsplit_once(':') {
            Some((host, port))
                if !host.is_empty()
                    && !host.contains(']')
                    && port.chars().all(|c| c.is_ascii_digit()) =>
            {
                host
            }
            _ => host,
        };
        host == format!("supervisor.{root}")
    }

    enum Device {
        Id(Vec<u8>),
        Missing,
        Malformed,
    }

    fn device_from_request(request: &HttpRequest) -> Device {
        let mut found = None;
        for header in &request.headers {
            if !header.matches("cookie") {
                continue;
            }
            for part in header.value.split(';') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                let Some((name, value)) = part.split_once('=') else {
                    return Device::Malformed;
                };
                if name.trim() == DEVICE_COOKIE {
                    if found.is_some() {
                        return Device::Malformed;
                    }
                    found = Some(value);
                }
            }
        }
        match found {
            None => Device::Missing,
            Some(value) => match decode_fixed_hex(value, DEVICE_ID_LEN) {
                Some(id) => Device::Id(id),
                None => Device::Malformed,
            },
        }
    }

    fn mint_device_id() -> Vec<u8> {
        let mut id = vec![0u8; DEVICE_ID_LEN];
        unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
        id
    }

    fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
        let body: BatchBody = serde_json::from_slice(body).ok()?;
        let mut changes = Vec::with_capacity(body.ops.len());
        for op in body.ops {
            if op.duration != "persistent" {
                return None;
            }
            let Some(key) = decode_fixed_hex(&op.key, KEY_LEN) else {
                return None;
            };
            match op.value {
                None => changes.push(Change::Delete { key }),
                Some(value) => {
                    let value = decode_base64url(&value)?;
                    if value.len() > MAX_VALUE_LEN {
                        return None;
                    }
                    changes.push(Change::Put { key, value });
                }
            }
        }
        Some(changes)
    }

    fn decode_fixed_hex(input: &str, byte_len: usize) -> Option<Vec<u8>> {
        if input.len() != byte_len * 2 {
            return None;
        }
        let bytes = input.as_bytes();
        let mut out = Vec::with_capacity(byte_len);
        for i in (0..bytes.len()).step_by(2) {
            let hi = hex_val(bytes[i])?;
            let lo = hex_val(bytes[i + 1])?;
            out.push((hi << 4) | lo);
        }
        Some(out)
    }

    fn hex_val(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        }
    }

    fn hex_encode(bytes: &[u8]) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut out = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            out.push(HEX[(byte >> 4) as usize] as char);
            out.push(HEX[(byte & 0xf) as usize] as char);
        }
        out
    }

    fn decode_base64url(input: &str) -> Option<Vec<u8>> {
        fn val(byte: u8) -> Option<u8> {
            match byte {
                b'A'..=b'Z' => Some(byte - b'A'),
                b'a'..=b'z' => Some(byte - b'a' + 26),
                b'0'..=b'9' => Some(byte - b'0' + 52),
                b'-' => Some(62),
                b'_' => Some(63),
                _ => None,
            }
        }
        let stripped = input.trim_end_matches('=');
        if input.len() - stripped.len() > 2 || stripped.bytes().any(|b| b == b'=') {
            return None;
        }
        let bytes = stripped.as_bytes();
        if bytes.len() % 4 == 1 {
            return None;
        }
        let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
        let mut i = 0;
        while i + 4 <= bytes.len() {
            let a = val(bytes[i])?;
            let b = val(bytes[i + 1])?;
            let c = val(bytes[i + 2])?;
            let d = val(bytes[i + 3])?;
            out.push((a << 2) | (b >> 4));
            out.push((b << 4) | (c >> 2));
            out.push((c << 6) | d);
            i += 4;
        }
        if bytes.len() - i == 2 {
            let a = val(bytes[i])?;
            let b = val(bytes[i + 1])?;
            out.push((a << 2) | (b >> 4));
        } else if bytes.len() - i == 3 {
            let a = val(bytes[i])?;
            let b = val(bytes[i + 1])?;
            let c = val(bytes[i + 2])?;
            out.push((a << 2) | (b >> 4));
            out.push((b << 4) | (c >> 2));
        }
        Some(out)
    }

    fn status_reply(status: u16) -> HttpReply {
        HttpReply {
            status,
            contentType: String::new(),
            body: Vec::new().into(),
            headers: Vec::new(),
        }
    }

    fn reply(
        request: &HttpRequest,
        origin: &str,
        status: u16,
        content_type: &str,
        body: Vec<u8>,
        preflight: bool,
        device_cookie: Option<String>,
    ) -> HttpReply {
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
                    "{DEVICE_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; Max-Age={COOKIE_MAX_AGE}; HttpOnly;"
                ),
            ));
        }
        HttpReply {
            status,
            contentType: content_type.to_string(),
            body: body.into(),
            headers,
        }
    }
}
