//! `host:db` storage on `hostdb.{root}`.
//!
//! Persistent and session key-value rows are scoped to the `__Host-HOSTDB-DEVICE`
//! cookie; session rows also use the `__Host-HOSTDB-SESSION` cookie.
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

    #[table(name = "DeviceTable", index = 2, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct DeviceRow {
        pub device: Vec<u8>,
        pub last_seen: u64,
    }

    impl DeviceRow {
        #[primary_key]
        fn by_device(&self) -> Vec<u8> {
            self.device.clone()
        }

        #[secondary_key(1)]
        fn by_last_seen(&self) -> (u64, Vec<u8>) {
            (self.last_seen, self.device.clone())
        }
    }
}

#[psibase::service(name = "hostdb", tables = "tables")]
mod service {
    use crate::tables::{DeviceRow, DeviceTable, KvRow, KvTable, SessionKvRow, SessionKvTable};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
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
    const NS_PER_SEC: u64 = 1_000_000_000;
    const DAY_SECS: u64 = 24 * 60 * 60;
    /// Device cookie `Max-Age`.
    const DEVICE_MAX_AGE_SECS: u64 = 400 * DAY_SECS;
    const DEVICE_SEEN_REFRESH_NS: u64 = DAY_SECS * NS_PER_SEC;
    /// `last_seen` trails the device cookie's last renewal by up to the refresh
    /// interval, so a device is idle only once both have passed.
    const DEVICE_IDLE_NS: u64 = DEVICE_MAX_AGE_SECS * NS_PER_SEC + DEVICE_SEEN_REFRESH_NS;
    /// `__WASI_CLOCKID_REALTIME`: wall-clock nanoseconds since the unix epoch.
    const CLOCK_REALTIME: u32 = 0;
    const SESSION_IDLE_NS: u64 = 7 * DAY_SECS * NS_PER_SEC;
    const GC_LIMIT: usize = 16;

    #[derive(Clone, Copy, PartialEq, Deserialize)]
    #[serde(rename_all = "lowercase")]
    enum Duration {
        Persistent,
        Session,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct BatchBody {
        ops: Vec<BatchOp>,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct BatchOp {
        duration: Duration,
        key: String,
        value: Option<String>,
    }

    struct Change {
        duration: Duration,
        key: Vec<u8>,
        value: Option<Vec<u8>>,
    }

    /// Serves HTTP for `host:db`. Only a secure `Origin` for `supervisor.{root}`
    /// (https, or http on localhost / `*.localhost`) is accepted.
    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            HttpServer::SERVICE,
            "permission denied: hostdb::serveSys only callable by 'http-server'",
        );

        let root = HttpServer::call().rootHost(request.host.clone());
        let Some(origin) = service_origin(&request, account!("supervisor"), &root) else {
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

    /// Routes storage requests. `OPTIONS` on storage paths is the CORS preflight.
    /// `POST /kv/batch` returns 204. An invalid op returns 400 and writes nothing.
    /// The session cookie is set once a session id is accepted, including on error
    /// responses such as 400.
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
                let session = if changes
                    .iter()
                    .any(|change| change.duration == Duration::Session)
                {
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

    /// GET response for `/kv/persistent/<key>` and `/kv/session/<key>`: raw value as
    /// `application/octet-stream` on 200, 404 when absent, 400 on a bad key.
    fn read_stored(
        key: &str,
        lookup: impl FnOnce(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<(u16, Option<Vec<u8>>), u16> {
        let key = decode_fixed_hex(key, KEY_LEN).ok_or(400u16)?;
        let value = lookup(&key);
        Ok(value.map_or((404, None), |body| (200, Some(body))))
    }

    /// Persistent lookup for `GET /kv/persistent/<key>`.
    fn read_persistent(device: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            record_seen(&DeviceTable::new(), device, wall_time_ns());
            KvTable::new()
                .get_index_pk()
                .get(&(device.to_vec(), key.to_vec()))
                .map(|row| row.value)
        }
    }

    /// Session lookup for `GET /kv/session/<key>`.
    fn read_session(device: &[u8], session: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            let now = wall_time_ns();
            record_seen(&DeviceTable::new(), device, now);
            let table = SessionKvTable::new();
            let pk = (device.to_vec(), session.to_vec(), key.to_vec());
            match table.get_index_pk().get(&pk) {
                Some(mut row) => {
                    row.last_access = now;
                    let value = row.value.clone();
                    table.put(&row).unwrap();
                    Some(value)
                }
                None => None,
            }
        }
    }

    /// Applies batch ops from `POST /kv/batch`:
    /// `{"ops":[{"duration":"persistent"|"session","key":<hex>,"value":<unpadded base64url>|null}]}`.
    /// A null value deletes the key.
    fn apply_changes(device: &[u8], session: Option<&[u8]>, changes: &[Change]) {
        let puts = |duration: Duration| {
            changes
                .iter()
                .any(|change| change.duration == duration && change.value.is_some())
        };
        let persistent_gc = puts(Duration::Persistent);
        let session_gc = puts(Duration::Session);
        subjective_tx! {
            let now = wall_time_ns();
            let persistent = KvTable::new();
            let sessions = SessionKvTable::new();
            let devices = DeviceTable::new();
            record_seen(&devices, device, now);
            for change in changes {
                match (change.duration, change.value.as_deref()) {
                    (Duration::Persistent, Some(value)) => {
                        persistent
                            .put(&KvRow {
                                device: device.to_vec(),
                                key: change.key.clone(),
                                value: value.to_vec(),
                            })
                            .unwrap();
                    }
                    (Duration::Persistent, None) => {
                        persistent.erase(&(device.to_vec(), change.key.clone()));
                    }
                    (Duration::Session, Some(value)) => {
                        sessions
                            .put(&SessionKvRow {
                                device: device.to_vec(),
                                session: session.unwrap().to_vec(),
                                key: change.key.clone(),
                                value: value.to_vec(),
                                last_access: now,
                            })
                            .unwrap();
                    }
                    (Duration::Session, None) => {
                        sessions.erase(&(
                            device.to_vec(),
                            session.unwrap().to_vec(),
                            change.key.clone(),
                        ));
                    }
                }
            }
            if persistent_gc {
                collect_idle_devices(&devices, &persistent, now);
            }
            if session_gc {
                collect_expired_sessions(&sessions, now);
            }
        }
    }

    fn is_storage_path(path: &str) -> bool {
        path == "/kv/batch"
            || path.starts_with("/kv/persistent/")
            || path.starts_with("/kv/session/")
    }

    enum CookieValue {
        Id(Vec<u8>),
        Missing,
        Malformed,
    }

    fn cookie_id(request: &HttpRequest, name: &str, byte_len: usize) -> CookieValue {
        let mut found = None;
        for part in request.cookies() {
            match part {
                CookiePart::Malformed => return CookieValue::Malformed,
                CookiePart::Pair {
                    name: cookie_name,
                    value,
                } if cookie_name == name => {
                    if found.is_some() {
                        return CookieValue::Malformed;
                    }
                    found = Some(value);
                }
                _ => {}
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
            .take(GC_LIMIT)
            .map(|row| (row.device, row.session, row.key))
            .collect();
        for key in stale {
            table.erase(&key);
        }
    }

    /// A `last_seen` ahead of `now` (the wall clock moved back) is rewritten.
    fn record_seen(devices: &DeviceTable, device: &[u8], now: u64) {
        let device = device.to_vec();
        let recently_seen = devices.get_index_pk().get(&device).is_some_and(|row| {
            now.checked_sub(row.last_seen)
                .is_some_and(|age| age <= DEVICE_SEEN_REFRESH_NS)
        });
        if !recently_seen {
            devices
                .put(&DeviceRow {
                    device,
                    last_seen: now,
                })
                .unwrap();
        }
    }

    /// Deletes up to `GC_LIMIT` persistent rows of idle devices, oldest device
    /// first, and forgets each idle device left with no rows.
    fn collect_idle_devices(devices: &DeviceTable, persistent: &KvTable, now: u64) {
        let cutoff = now.saturating_sub(DEVICE_IDLE_NS);
        let idle: Vec<_> = devices
            .get_index_by_last_seen()
            .range(..(cutoff, Vec::new()))
            .take(GC_LIMIT)
            .map(|row| row.device)
            .collect();
        let mut budget = GC_LIMIT;
        for device in idle {
            let (erased, drained) = erase_device_rows(persistent, &device, budget);
            if drained {
                devices.erase(&device);
            }
            budget -= erased;
            if budget == 0 {
                break;
            }
        }
    }

    /// Erases up to `limit` of `device`'s persistent rows. Returns how many were
    /// erased and whether none remain.
    fn erase_device_rows(persistent: &KvTable, device: &[u8], limit: usize) -> (usize, bool) {
        let mut keys: Vec<_> = persistent
            .get_index_pk()
            .range((device.to_vec(), Vec::new())..)
            .take_while(|row| row.device == device)
            .take(limit + 1)
            .map(|row| row.key)
            .collect();
        let drained = keys.len() <= limit;
        keys.truncate(limit);
        for key in &keys {
            persistent.erase(&(device, key));
        }
        (keys.len(), drained)
    }

    fn parse_batch(body: &[u8]) -> Option<Vec<Change>> {
        let body: BatchBody = serde_json::from_slice(body).ok()?;
        let mut changes = Vec::with_capacity(body.ops.len());
        for op in body.ops {
            let key = decode_fixed_hex(&op.key, KEY_LEN)?;
            let value = match op.value {
                None => None,
                Some(value) => {
                    let value = URL_SAFE_NO_PAD.decode(value).ok()?;
                    if value.len() > MAX_VALUE_LEN {
                        return None;
                    }
                    Some(value)
                }
            };
            changes.push(Change {
                duration: op.duration,
                key,
                value,
            });
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

    /// Cookie values are lowercase hex.
    fn hex_encode(bytes: &[u8]) -> String {
        Hex(bytes).to_string().to_ascii_lowercase()
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
}
