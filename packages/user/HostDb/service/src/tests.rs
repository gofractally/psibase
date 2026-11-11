#[cfg(test)]
mod tests {
    use crate::batch::Duration::{self, *};
    use crate::policy::{
        DEVICE_COOKIE, DEVICE_ID_LEN, DEVICE_RETENTION_SECS, KEY_LEN, SESSION_COOKIE,
        SESSION_RETENTION_SECS,
    };
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use psibase::*;

    const HOST: &str = "hostdb.psibase.io";
    const ORIGIN: &str = "https://supervisor.psibase.io";

    fn fill_hex(byte: u8, len: usize) -> String {
        format!("{byte:02x}").repeat(len)
    }

    fn device_a() -> String {
        fill_hex(0x11, DEVICE_ID_LEN)
    }

    fn device_b() -> String {
        fill_hex(0x22, DEVICE_ID_LEN)
    }

    fn session_a() -> String {
        "1".into()
    }

    fn session_b() -> String {
        "2".into()
    }

    fn storage_key() -> String {
        fill_hex(0xab, KEY_LEN)
    }

    fn other_key() -> String {
        fill_hex(0xcd, KEY_LEN)
    }

    fn gc_key() -> String {
        fill_hex(0xee, KEY_LEN)
    }

    fn cookies(device: &str, session: Option<&str>) -> String {
        match session {
            Some(session) => format!("{DEVICE_COOKIE}={device}; {SESSION_COOKIE}={session}"),
            None => format!("{DEVICE_COOKIE}={device}"),
        }
    }

    fn encode(bytes: &[u8]) -> String {
        STANDARD.encode(bytes)
    }

    fn send(
        chain: &Chain,
        method: &str,
        target: &str,
        origin: Option<&str>,
        cookie: Option<&str>,
        extra: &[(&str, &str)],
        content_type: &str,
        body: Vec<u8>,
    ) -> Result<HttpReply, Error> {
        let mut headers = Vec::new();
        if let Some(origin) = origin {
            headers.push(HttpHeader::new("Origin", origin));
        }
        if let Some(cookie) = cookie {
            headers.push(HttpHeader::new("Cookie", cookie));
        }
        for (name, value) in extra {
            headers.push(HttpHeader::new(name, value));
        }
        chain.http(&HttpRequest {
            host: HOST.into(),
            method: method.into(),
            target: target.into(),
            contentType: content_type.into(),
            headers,
            body: body.into(),
        })
    }

    fn store_body(duration: Duration, key: &str, value: &str) -> Vec<u8> {
        format!(r#"{{"ops":[{{"duration":"{duration}","key":"{key}","value":"{value}"}}]}}"#)
            .into_bytes()
    }

    fn expected_batch(duration: Duration, key: &str, value: &str, expected: &str) -> Vec<u8> {
        format!(
            r#"{{"ops":[{{"duration":"{duration}","key":"{key}","value":"{value}","expected":"{expected}"}}]}}"#,
        )
        .into_bytes()
    }

    fn post_batch(chain: &Chain, cookie: &str, body: Vec<u8>) -> Result<HttpReply, Error> {
        send(
            chain,
            "POST",
            "/kv/batch",
            Some(ORIGIN),
            Some(cookie),
            &[],
            "application/json",
            body,
        )
    }

    fn post_store(
        chain: &Chain,
        cookie: &str,
        duration: Duration,
        key: &str,
        value: &str,
    ) -> Result<HttpReply, Error> {
        post_batch(chain, cookie, store_body(duration, key, value))
    }

    fn get(
        chain: &Chain,
        target: &str,
        origin: Option<&str>,
        cookie: Option<&str>,
    ) -> Result<HttpReply, Error> {
        send(chain, "GET", target, origin, cookie, &[], "", Vec::new())
    }

    fn options(chain: &Chain, target: &str, extra: &[(&str, &str)]) -> Result<HttpReply, Error> {
        send(
            chain,
            "OPTIONS",
            target,
            Some(ORIGIN),
            None,
            extra,
            "",
            Vec::new(),
        )
    }

    fn get_key(chain: &Chain, kind: Duration, cookie: &str, key: &str) -> Result<HttpReply, Error> {
        send(
            chain,
            "GET",
            &format!("/kv/{kind}/{key}"),
            Some(ORIGIN),
            Some(cookie),
            &[],
            "",
            Vec::new(),
        )
    }

    #[track_caller]
    fn assert_status(reply: &HttpReply, status: HttpStatus) {
        assert_eq!(reply.status, status as u16);
    }

    fn header<'a>(reply: &'a HttpReply, name: &str) -> Option<&'a str> {
        reply
            .headers
            .iter()
            .find(|h| h.matches(name))
            .map(|h| h.value.as_str())
    }

    fn require_cookie<'a>(reply: &'a HttpReply, name: &str) -> &'a str {
        set_cookie(reply, name).expect(name)
    }

    fn set_cookie_header<'a>(reply: &'a HttpReply, name: &str) -> &'a str {
        reply
            .headers
            .iter()
            .find(|header| header.matches("set-cookie") && header.value.starts_with(name))
            .expect(name)
            .value
            .as_str()
    }

    fn set_cookie<'a>(reply: &'a HttpReply, name: &str) -> Option<&'a str> {
        let prefix = format!("{name}=");
        reply.headers.iter().find_map(|header| {
            if !header.matches("set-cookie") {
                return None;
            }
            let pair = header
                .value
                .split_once(';')
                .map_or(header.value.as_str(), |(pair, _)| pair);
            pair.strip_prefix(&prefix)
        })
    }

    fn assert_cors(reply: &HttpReply) {
        assert_eq!(header(reply, "access-control-allow-origin"), Some(ORIGIN));
        assert_eq!(
            header(reply, "access-control-allow-credentials"),
            Some("true")
        );
    }

    fn assert_cookie_attrs(raw: &str) {
        for attr in ["Path=/", "SameSite=Strict", "Secure", "HttpOnly"] {
            assert!(raw.contains(attr), "{raw}");
        }
    }

    #[track_caller]
    fn assert_stored(
        chain: &Chain,
        kind: Duration,
        cookie: &str,
        key: &str,
        value: &[u8],
    ) -> Result<(), Error> {
        let reply = get_key(chain, kind, cookie, key)?;
        assert_status(&reply, HttpStatus::Ok);
        assert_eq!(reply.body.0, value);
        Ok(())
    }

    #[track_caller]
    fn assert_absent(chain: &Chain, kind: Duration, cookie: &str, key: &str) -> Result<(), Error> {
        let reply = get_key(chain, kind, cookie, key)?;
        assert_status(&reply, HttpStatus::NotFound);
        Ok(())
    }

    fn collect_garbage(chain: &Chain) -> Result<(), Error> {
        let reply = post_store(
            chain,
            &cookies(&device_b(), None),
            Persistent,
            &gc_key(),
            &encode(b"gc"),
        )?;
        assert_status(&reply, HttpStatus::NoContent);
        Ok(())
    }

    /// HTTP requests run against the head block, and `currentBlock` is that head plus one
    /// second. Finish the block so the next request observes `head`.
    fn set_head(chain: &Chain, microseconds: i64) {
        chain.start_block_at(TimePointUSec { microseconds });
        chain.finish_block();
    }

    /// One second past the head. Finish any open block first: while one is open,
    /// `current.time` is that block, and finishing it makes that time the head.
    fn next_block_time(chain: &Chain) -> i64 {
        chain.finish_block();
        let status = chain
            .kv_get::<StatusRow, _>(StatusRow::DB, &status_key())
            .unwrap()
            .unwrap();
        status.current.time.microseconds
    }

    fn expires_after_idle(
        chain: &Chain,
        duration: Duration,
        cookie: &str,
        value: &[u8],
    ) -> Result<(), Error> {
        let second = 1_000_000i64;
        let retention_secs = match duration {
            Persistent => DEVICE_RETENTION_SECS,
            Session => SESSION_RETENTION_SECS,
        };
        let retention = retention_secs as i64 * second;
        let head = next_block_time(chain);
        let key = storage_key();
        set_head(chain, head);
        let stored = post_store(chain, cookie, duration, &key, &encode(value))?;
        assert_status(&stored, HttpStatus::NoContent);

        // Age is exactly one retention. The cutoff is exclusive, so the row stays.
        // The read refreshes idle time.
        let still_inside = head + retention;
        set_head(chain, still_inside);
        collect_garbage(chain)?;
        assert_stored(chain, duration, cookie, &key, value)?;

        // One second past the original window. A new block has to start in a
        // later second. Collection would drop the row if the read above had
        // not refreshed it.
        let refreshed = still_inside + second;
        set_head(chain, refreshed);
        collect_garbage(chain)?;
        assert_stored(chain, duration, cookie, &key, value)?;

        // One second past a full window from that read.
        let past = refreshed + retention + second;
        set_head(chain, past);
        collect_garbage(chain)?;
        assert_absent(chain, duration, cookie, &key)?;
        Ok(())
    }

    #[psibase::test_case(packages("HostDb"))]
    fn storage_scopes(chain: Chain) -> Result<(), Error> {
        chain.start_block();
        let persistent = b"persistent-value";
        let session = b"session-value";
        let key = storage_key();
        let device = cookies(&device_a(), None);
        let session_cookie = cookies(&device_a(), Some(&session_a()));
        let other_session = cookies(&device_a(), Some(&session_b()));
        let other_device = cookies(&device_b(), Some(&session_a()));

        let stored = post_store(&chain, &device, Persistent, &key, &encode(persistent))?;
        assert_status(&stored, HttpStatus::NoContent);
        assert_stored(&chain, Persistent, &device, &key, persistent)?;
        assert_absent(&chain, Persistent, &cookies(&device_b(), None), &key)?;
        assert_absent(&chain, Persistent, &device, &other_key())?;
        assert_absent(&chain, Session, &session_cookie, &key)?;

        let stored = post_store(&chain, &session_cookie, Session, &key, &encode(session))?;
        assert_status(&stored, HttpStatus::NoContent);
        assert_stored(&chain, Session, &session_cookie, &key, session)?;
        assert_absent(&chain, Session, &other_session, &key)?;
        assert_absent(&chain, Session, &other_device, &key)?;
        assert_absent(&chain, Session, &session_cookie, &other_key())?;
        assert_stored(&chain, Persistent, &device, &key, persistent)?;
        Ok(())
    }

    #[psibase::test_case(packages("HostDb"))]
    fn expiry(chain: Chain) -> Result<(), Error> {
        let session_cookie = cookies(&device_a(), Some(&session_a()));
        let device = cookies(&device_a(), None);
        let session = b"session-value";
        let persistent = b"persistent-value";
        expires_after_idle(&chain, Session, &session_cookie, session)?;
        expires_after_idle(&chain, Persistent, &device, persistent)?;
        Ok(())
    }

    #[psibase::test_case(packages("HostDb"))]
    fn http_responses(chain: Chain) -> Result<(), Error> {
        chain.start_block();
        let key = storage_key();
        let target = format!("/kv/{}/{key}", Persistent);
        let session_target = format!("/kv/{}/{key}", Session);
        let bad_target = format!("/kv/{}/zz", Persistent);
        let device = device_a();
        let cookie = cookies(&device, None);
        let preflight_headers = [("Access-Control-Request-Headers", "content-type")];
        let bad_device_cookie = format!("{DEVICE_COOKIE}=abcd");
        let duplicate_cookie = format!("{DEVICE_COOKIE}={device}; {DEVICE_COOKIE}={device}");
        let bad_cookie = format!("{cookie}; {SESSION_COOKIE}=zz");
        let max_age = format!("Max-Age={DEVICE_RETENTION_SECS}");

        // A missing device cookie is minted.
        let minted = get(&chain, &target, Some(ORIGIN), None)?;
        assert_status(&minted, HttpStatus::NotFound);
        assert_cors(&minted);
        let minted_device = require_cookie(&minted, DEVICE_COOKIE);
        assert_eq!(minted_device.len(), DEVICE_ID_LEN * 2); // hex encoding uses two chars per byte
        let minted_header = set_cookie_header(&minted, DEVICE_COOKIE);
        assert_cookie_attrs(minted_header);
        assert!(minted_header.contains(&max_age));

        // An existing device cookie is echoed unchanged.
        let known = get(&chain, &target, Some(ORIGIN), Some(&cookie))?;
        assert_status(&known, HttpStatus::NotFound);
        assert_eq!(set_cookie(&known, DEVICE_COOKIE), Some(device.as_str()));
        let known_header = set_cookie_header(&known, DEVICE_COOKIE);
        assert_cookie_attrs(known_header);

        // A malformed device cookie is rejected.
        let bad_device = get(&chain, &target, Some(ORIGIN), Some(&bad_device_cookie))?;
        assert_status(&bad_device, HttpStatus::BadRequest);
        assert_cors(&bad_device);
        assert_eq!(set_cookie(&bad_device, DEVICE_COOKIE), None);

        // A duplicate device cookie is rejected.
        let duplicate_device = get(&chain, &target, Some(ORIGIN), Some(&duplicate_cookie))?;
        assert_status(&duplicate_device, HttpStatus::BadRequest);
        assert_cors(&duplicate_device);
        assert_eq!(set_cookie(&duplicate_device, DEVICE_COOKIE), None);

        // A persistent route ignores the session cookie.
        let ignored_session = get(&chain, &target, Some(ORIGIN), Some(&bad_cookie))?;
        assert_status(&ignored_session, HttpStatus::NotFound);

        // A malformed session cookie is rejected on a session read.
        let bad_session = get(&chain, &session_target, Some(ORIGIN), Some(&bad_cookie))?;
        assert_status(&bad_session, HttpStatus::BadRequest);
        assert_eq!(set_cookie(&bad_session, SESSION_COOKIE), None);

        // A session read with no session cookie mints one.
        let minted_session = get(&chain, &session_target, Some(ORIGIN), Some(&cookie))?;
        assert_status(&minted_session, HttpStatus::NotFound);
        require_cookie(&minted_session, SESSION_COOKIE);
        let session_header = set_cookie_header(&minted_session, SESSION_COOKIE);
        assert_cookie_attrs(session_header);

        // Preflight allows GET, POST, and the requested headers.
        let preflight = options(&chain, "/kv/batch", &preflight_headers)?;
        assert_status(&preflight, HttpStatus::NoContent);
        assert_cors(&preflight);
        let methods = header(&preflight, "access-control-allow-methods");
        let allow_headers = header(&preflight, "access-control-allow-headers");
        assert_eq!(methods, Some("GET, POST"));
        assert_eq!(allow_headers, Some("content-type"));
        let get_preflight = options(&chain, &target, &preflight_headers)?;
        assert_status(&get_preflight, HttpStatus::NoContent);
        assert_cors(&get_preflight);
        let get_methods = header(&get_preflight, "access-control-allow-methods");
        assert_eq!(get_methods, Some("GET, POST"));

        // An unknown path is not found.
        let not_storage = options(&chain, "/nope", &[])?;
        assert_status(&not_storage, HttpStatus::NotFound);
        let unknown = get(&chain, "/nope", Some(ORIGIN), Some(&cookie))?;
        assert_status(&unknown, HttpStatus::NotFound);

        // A storage key with bad hex is rejected.
        let bad_key = get(&chain, &bad_target, Some(ORIGIN), Some(&cookie))?;
        assert_status(&bad_key, HttpStatus::BadRequest);

        // A batch body without ops is rejected.
        let bad_json = post_batch(&chain, &cookie, b"{}".to_vec())?;
        assert_status(&bad_json, HttpStatus::BadRequest);

        // A stale expected hash conflicts and leaves the stored value.
        let value = b"ciphertext-v1";
        let stored = post_store(&chain, &cookie, Persistent, &key, &encode(value))?;
        assert_status(&stored, HttpStatus::NoContent);
        let stale_hash = lowercase_hex(&sha256(b"ciphertext-v0").0);
        let next = encode(b"ciphertext-v2");
        let body = expected_batch(Persistent, &key, &next, &stale_hash);
        let conflict = post_batch(&chain, &cookie, body)?;
        assert_status(&conflict, HttpStatus::Conflict);
        assert_stored(&chain, Persistent, &cookie, &key, value)?;

        // A session write with a malformed session cookie stores nothing.
        let nope = store_body(Session, &key, &encode(b"nope"));
        let bad_session_write = post_batch(&chain, &bad_cookie, nope)?;
        assert_status(&bad_session_write, HttpStatus::BadRequest);
        assert_absent(&chain, Session, &cookies(&device, Some(&session_a())), &key)?;

        // A session write with no session cookie mints one.
        let minted_write = post_store(&chain, &cookie, Session, &key, &encode(b"minted"))?;
        assert_status(&minted_write, HttpStatus::NoContent);
        let minted_write_id = require_cookie(&minted_write, SESSION_COOKIE);
        let minted_cookie = cookies(&device, Some(minted_write_id));
        assert_stored(&chain, Session, &minted_cookie, &key, b"minted")?;
        Ok(())
    }

    #[psibase::test_case(packages("HostDb"))]
    fn session_ids(chain: Chain) -> Result<(), Error> {
        chain.start_block();
        let key = storage_key();
        let device = cookies(&device_a(), None);
        let other_device = cookies(&device_b(), None);

        let first = post_store(&chain, &device, Session, &key, &encode(b"first"))?;
        assert_status(&first, HttpStatus::NoContent);
        assert_eq!(require_cookie(&first, SESSION_COOKIE), "1");

        let second = post_store(&chain, &device, Session, &key, &encode(b"second"))?;
        assert_status(&second, HttpStatus::NoContent);
        assert_eq!(require_cookie(&second, SESSION_COOKIE), "2");
        assert_stored(
            &chain,
            Session,
            &cookies(&device_a(), Some("1")),
            &key,
            b"first",
        )?;
        assert_stored(
            &chain,
            Session,
            &cookies(&device_a(), Some("2")),
            &key,
            b"second",
        )?;

        let other = post_store(&chain, &other_device, Session, &key, &encode(b"other"))?;
        assert_status(&other, HttpStatus::NoContent);
        assert_eq!(require_cookie(&other, SESSION_COOKIE), "1");
        assert_stored(
            &chain,
            Session,
            &cookies(&device_b(), Some("1")),
            &key,
            b"other",
        )?;
        assert_stored(
            &chain,
            Session,
            &cookies(&device_a(), Some("1")),
            &key,
            b"first",
        )?;
        Ok(())
    }

    fn lowercase_hex(bytes: &[u8]) -> String {
        Hex(bytes).to_string().to_ascii_lowercase()
    }
}
