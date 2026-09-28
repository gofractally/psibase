/// `host:db` storage on `hostdb.{root}`.
///
/// `GET /kv/persistent/<key>` and `GET /kv/session/<key>` return the raw value
/// (`application/octet-stream`), or 404 when it is absent. `POST /kv/batch`
/// applies `{"ops":[{"duration":"persistent"|"session","key":<hex>,"value":<base64url>|null}]}`
/// in one subjective transaction and returns 204; a null value deletes the key.
/// An invalid op returns 400 and writes nothing. `OPTIONS` on these paths is the
/// CORS preflight. Only `Origin: supervisor.{root}` is accepted.
///
/// The device id is the `__Host-HOSTDB-DEVICE` cookie. Session rows are keyed by
/// that device, the `__Host-HOSTDB-SESSION` cookie, and the key. A session
/// request that lacks a session cookie starts an empty session. Each session
/// row records `lastAccess`, updated on get and put. A batch that puts a session
/// row also deletes up to 16 session rows on the node whose `lastAccess` is more
/// than 7 days old.
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

    #[table(name = "SessionKvTable", index = 1, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct SessionKvRow {
        pub device: Vec<u8>,
        pub session: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
        pub last_access: u64,
    }

    impl SessionKvRow {
        #[primary_key]
        fn by_device_session_key(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
            (self.device.clone(), self.session.clone(), self.key.clone())
        }

        /// `last_access` leads so the index is oldest-first. The row identity
        /// follows so each row has its own index entry.
        #[secondary_key(1)]
        fn by_last_access(&self) -> (u64, Vec<u8>, Vec<u8>, Vec<u8>) {
            (
                self.last_access,
                self.device.clone(),
                self.session.clone(),
                self.key.clone(),
            )
        }
    }
}

#[psibase::service(name = "hostdb", tables = "tables")]
mod service {
    use crate::tables::{KvRow, KvTable, SessionKvRow, SessionKvTable};
    use psibase::native_raw;
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::*;
    use serde::Deserialize;

    const DEVICE_COOKIE: &str = "__Host-HOSTDB-DEVICE";
    const SESSION_COOKIE: &str = "__Host-HOSTDB-SESSION";
    const ID_LEN: usize = 16;
    const KEY_LEN: usize = 32;
    /// 100 KB plaintext plus the 12-byte nonce and 16-byte GCM tag `host:db` stores.
    const MAX_VALUE_LEN: usize = 100 * 1024 + 28;
    const COOKIE_MAX_AGE: u64 = 400 * 24 * 60 * 60;
    /// `__WASI_CLOCKID_REALTIME`: wall-clock nanoseconds since the unix epoch.
    const CLOCK_REALTIME: u32 = 0;
    const SESSION_IDLE_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
    const SESSION_GC_LIMIT: usize = 16;

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

    enum Duration {
        Persistent,
        Session,
    }

    enum Change {
        Put {
            duration: Duration,
            key: Vec<u8>,
            value: Vec<u8>,
        },
        Delete {
            duration: Duration,
            key: Vec<u8>,
        },
    }

    impl Change {
        fn is_session(&self) -> bool {
            matches!(
                self,
                Change::Put {
                    duration: Duration::Session,
                    ..
                } | Change::Delete {
                    duration: Duration::Session,
                    ..
                }
            )
        }

        fn is_session_put(&self) -> bool {
            matches!(
                self,
                Change::Put {
                    duration: Duration::Session,
                    ..
                }
            )
        }
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
        };

        let device = match cookie_id(&request, DEVICE_COOKIE, ID_LEN) {
            CookieValue::Id(id) => Some(id),
            CookieValue::Missing => Some(mint_id()),
            CookieValue::Malformed => None,
        };
        let (result, device_cookie, session_cookie) = match device {
            Some(device) => {
                let (result, session_cookie) = route(&request, &device);
                (result, Some(hex_encode(&device)), session_cookie)
            }
            None => (Err(400u16), None, None),
        };
        let (status, body) = result.unwrap_or_else(|status| (status, None));
        Some(reply(
            &request,
            origin,
            status,
            body,
            device_cookie,
            session_cookie,
        ))
    }

    /// The session cookie is set once a session id is accepted, including when the
    /// route then returns `Err`.
    fn route(
        request: &HttpRequest,
        device: &[u8],
    ) -> (Result<(u16, Option<Vec<u8>>), u16>, Option<String>) {
        let mut session_cookie = None;
        let result = (|| -> Result<(u16, Option<Vec<u8>>), u16> {
            let path = request.path();
            let path = path.as_ref();
            if request.method == "OPTIONS" && is_storage_path(path) {
                return Ok((204, None));
            }

            if request.method == "GET" {
                if let Some(key) = path.strip_prefix("/kv/persistent/") {
                    return read_stored(key, |key| read_persistent(device, key));
                }
                if let Some(key) = path.strip_prefix("/kv/session/") {
                    let session = session_id(request).ok_or(400u16)?;
                    session_cookie = Some(hex_encode(&session));
                    return read_stored(key, |key| read_session(device, &session, key));
                }
            }

            if request.method == "POST" && path == "/kv/batch" {
                let changes = parse_batch(&request.body.0).ok_or(400u16)?;
                let session = if changes.iter().any(Change::is_session) {
                    let session = session_id(request).ok_or(400u16)?;
                    session_cookie = Some(hex_encode(&session));
                    Some(session)
                } else {
                    None
                };
                apply_changes(device, session.as_deref(), &changes);
                return Ok((204, None));
            }

            Ok((404, None))
        })();
        (result, session_cookie)
    }

    fn read_stored(
        key: &str,
        lookup: impl FnOnce(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<(u16, Option<Vec<u8>>), u16> {
        let key = decode_fixed_hex(key, KEY_LEN).ok_or(400u16)?;
        let value = lookup(&key);
        Ok(value.map_or((404, None), |body| (200, Some(body))))
    }

    fn read_persistent(device: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            KvTable::new()
                .get_index_pk()
                .get(&(device.to_vec(), key.to_vec()))
                .map(|row| row.value)
        }
    }

    fn read_session(device: &[u8], session: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            let table = SessionKvTable::new();
            let pk = (device.to_vec(), session.to_vec(), key.to_vec());
            match table.get_index_pk().get(&pk) {
                Some(mut row) => {
                    row.last_access = wall_time_ns();
                    let value = row.value.clone();
                    table.put(&row).unwrap();
                    Some(value)
                }
                None => None,
            }
        }
    }

    fn apply_changes(device: &[u8], session: Option<&[u8]>, changes: &[Change]) {
        let gc = changes.iter().any(Change::is_session_put);
        subjective_tx! {
            let now = wall_time_ns();
            let persistent = KvTable::new();
            let sessions = SessionKvTable::new();
            for change in changes {
                match change {
                    Change::Put {
                        duration: Duration::Persistent,
                        key,
                        value,
                    } => {
                        persistent
                            .put(&KvRow {
                                device: device.to_vec(),
                                key: key.clone(),
                                value: value.clone(),
                            })
                            .unwrap();
                    }
                    Change::Delete {
                        duration: Duration::Persistent,
                        key,
                    } => {
                        persistent.erase(&(device.to_vec(), key.clone()));
                    }
                    Change::Put {
                        duration: Duration::Session,
                        key,
                        value,
                    } => {
                        sessions
                            .put(&SessionKvRow {
                                device: device.to_vec(),
                                session: session.unwrap().to_vec(),
                                key: key.clone(),
                                value: value.clone(),
                                last_access: now,
                            })
                            .unwrap();
                    }
                    Change::Delete {
                        duration: Duration::Session,
                        key,
                    } => {
                        sessions.erase(&(device.to_vec(), session.unwrap().to_vec(), key.clone()));
                    }
                }
            }
            if gc {
                collect_expired_sessions(&sessions, now);
            }
        }
    }

    fn is_storage_path(path: &str) -> bool {
        path == "/kv/batch"
            || path.starts_with("/kv/persistent/")
            || path.starts_with("/kv/session/")
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

    enum CookieValue {
        Id(Vec<u8>),
        Missing,
        Malformed,
    }

    fn cookie_id(request: &HttpRequest, name: &str, byte_len: usize) -> CookieValue {
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
                let Some((cookie_name, value)) = part.split_once('=') else {
                    return CookieValue::Malformed;
                };
                if cookie_name.trim() == name {
                    if found.is_some() {
                        return CookieValue::Malformed;
                    }
                    found = Some(value);
                }
            }
        }
        match found {
            None => CookieValue::Missing,
            Some(value) => match decode_fixed_hex(value, byte_len) {
                Some(id) => CookieValue::Id(id),
                None => CookieValue::Malformed,
            },
        }
    }

    /// Session id for a session read or write. `None` when the cookie is present
    /// and malformed; a missing cookie starts an empty session.
    fn session_id(request: &HttpRequest) -> Option<Vec<u8>> {
        match cookie_id(request, SESSION_COOKIE, ID_LEN) {
            CookieValue::Id(id) => Some(id),
            CookieValue::Missing => Some(mint_id()),
            CookieValue::Malformed => None,
        }
    }

    fn mint_id() -> Vec<u8> {
        let mut id = vec![0u8; ID_LEN];
        unsafe { native_raw::getRandom(id.as_mut_ptr(), id.len()) };
        id
    }

    fn wall_time_ns() -> u64 {
        let mut time = 0u64;
        let err = unsafe { native_raw::clockTimeGet(CLOCK_REALTIME, &mut time) };
        if err != 0 {
            abort_message("clockTimeGet failed");
        }
        time
    }

    fn collect_expired_sessions(table: &SessionKvTable, now: u64) {
        let cutoff = now.saturating_sub(SESSION_IDLE_NS);
        let stale: Vec<_> = table
            .get_index_by_last_access()
            .range(..(cutoff, Vec::new(), Vec::new(), Vec::new()))
            .take(SESSION_GC_LIMIT)
            .map(|row| (row.device, row.session, row.key))
            .collect();
        for key in stale {
            table.erase(&key);
        }
    }

    fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
        let body: BatchBody = serde_json::from_slice(body).ok()?;
        let mut changes = Vec::with_capacity(body.ops.len());
        for op in body.ops {
            let duration = match op.duration.as_str() {
                "persistent" => Duration::Persistent,
                "session" => Duration::Session,
                _ => return None,
            };
            let Some(key) = decode_fixed_hex(&op.key, KEY_LEN) else {
                return None;
            };
            match op.value {
                None => changes.push(Change::Delete { duration, key }),
                Some(value) => {
                    let value = decode_base64url(&value)?;
                    if value.len() > MAX_VALUE_LEN {
                        return None;
                    }
                    changes.push(Change::Put {
                        duration,
                        key,
                        value,
                    });
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
        body: Option<Vec<u8>>,
        device_cookie: Option<String>,
        session_cookie: Option<String>,
    ) -> HttpReply {
        let content_type = if body.is_some() {
            "application/octet-stream"
        } else {
            ""
        };
        // Not every OPTIONS response is a preflight: a malformed cookie is 400 and
        // an unknown path is 404.
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
                    "{DEVICE_COOKIE}={cookie}; Path=/; SameSite=Strict; Secure; Max-Age={COOKIE_MAX_AGE}; HttpOnly;"
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
}
