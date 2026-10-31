//! Node-local key-value store for supervisor `host:db` data.
//!
//! Persistent rows are device-scoped and expire after ~400 days of idle time.
//!
//! Session rows are keyed by the session cookie and expire after 7 days of idle
//! time.
mod helpers;
mod tables;

#[psibase::service(name = "hostdb", tables = "tables::tables")]
mod service {
    use crate::helpers::{
        check_precondition, collect_idle_devices, decode_fixed_hex, device_id, device_store,
        hex_encode, parse_batch, reply, session_id, status_reply, wall_time_ns, Change, Duration,
        Precondition, GC_LIMIT, KEY_LEN, SESSION_IDLE_NS,
    };
    use crate::tables::tables::{DeviceTable, KvRow, KvTable, SessionKvRow, SessionKvTable};
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::*;

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

        let device = device_id(&request);
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
    /// An op whose `expected` hash does not match the stored value returns 409
    /// and writes nothing. The session cookie is set once a session id is
    /// accepted, including on error responses such as 400 and 409.
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
                apply_changes(device, session.as_deref(), &changes)?;
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
        let key = decode_fixed_hex::<KEY_LEN>(key).ok_or(400u16)?;
        let value = lookup(&key);
        Ok(value.map_or((404, None), |body| (200, Some(body))))
    }

    /// Persistent lookup for `GET /kv/persistent/<key>`.
    fn read_persistent(device: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            let store = device_store(&DeviceTable::new(), device, wall_time_ns());
            KvTable::new()
                .get_index(0)
                .get(&(&store[..], key))
                .map(|row| row.value)
        }
    }

    /// Session lookup for `GET /kv/session/<key>`.
    fn read_session(device: &[u8], session: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        subjective_tx! {
            let now = wall_time_ns();
            let store = device_store(&DeviceTable::new(), device, now);
            let table = SessionKvTable::new();
            match table.get_index(0).get(&(&store[..], session, key)) {
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

    /// Applies batch ops from `POST /kv/batch`. A null `value` deletes the key.
    /// `expected` is the SHA-256 hex of the ciphertext from GET, or null when
    /// that GET was absent. Omit it to write unconditionally. A mismatch
    /// returns 409 and writes nothing.
    fn apply_changes(device: &[u8], session: Option<&[u8]>, changes: &[Change]) -> Result<(), u16> {
        let puts = |duration: Duration| {
            changes
                .iter()
                .any(|change| change.duration == duration && change.value().is_some())
        };
        let persistent_gc = puts(Duration::Persistent);
        let session_gc = puts(Duration::Session);
        subjective_tx! {
            let now = wall_time_ns();
            let persistent = KvTable::new();
            let sessions = SessionKvTable::new();
            let devices = DeviceTable::new();
            let store = device_store(&devices, device, now);
            for change in changes {
                if let Precondition::Read(expected) = &change.expected {
                    let stored =
                        current_value(&persistent, &sessions, &store, session, change);
                    check_precondition(stored.as_deref(), expected)?;
                }
                match (change.duration, change.value()) {
                    (Duration::Persistent, Some(value)) => {
                        persistent
                            .put(&KvRow {
                                store: store.clone(),
                                key: change.key().to_vec(),
                                value: value.to_vec(),
                            })
                            .unwrap();
                    }
                    (Duration::Persistent, None) => {
                        persistent.erase(&(&store[..], change.key()));
                    }
                    (Duration::Session, Some(value)) => {
                        sessions
                            .put(&SessionKvRow {
                                store: store.clone(),
                                session: session.unwrap().to_vec(),
                                key: change.key().to_vec(),
                                value: value.to_vec(),
                                last_access: now,
                            })
                            .unwrap();
                    }
                    (Duration::Session, None) => {
                        sessions.erase(&(&store[..], session.unwrap(), change.key()));
                    }
                }
            }
            if persistent_gc {
                collect_idle_devices(&devices, &persistent, now);
            }
            if session_gc {
                erase_expired_sessions(&sessions, now);
            }
            Ok(())
        }
    }

    fn current_value(
        persistent: &KvTable,
        sessions: &SessionKvTable,
        store: &[u8],
        session: Option<&[u8]>,
        change: &Change,
    ) -> Option<Vec<u8>> {
        match change.duration {
            Duration::Persistent => persistent
                .get_index(0)
                .get(&(store, change.key()))
                .map(|row| row.value),
            Duration::Session => sessions
                .get_index(0)
                .get(&(store, session.unwrap(), change.key()))
                .map(|row| row.value),
        }
    }

    fn is_storage_path(path: &str) -> bool {
        path == "/kv/batch"
            || path.starts_with("/kv/persistent/")
            || path.starts_with("/kv/session/")
    }

    fn erase_expired_sessions(table: &SessionKvTable, now: u64) {
        let cutoff = now.saturating_sub(SESSION_IDLE_NS);
        let index = table.get_index_by_last_access();
        for row in index
            .range(..(cutoff, Vec::new(), Vec::new(), Vec::new()))
            .take(GC_LIMIT)
        {
            table.remove(&row);
        }
    }
}

#[cfg(test)]
mod tests;
