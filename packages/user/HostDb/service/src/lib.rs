//! Node-local key-value store for supervisor `host:db` data.
//!
//! Persistent rows are device-scoped and expire after ~400 days of idle time.
//!
//! Session rows are keyed by the session cookie and expire after 7 days of idle
//! time.
mod base64;
mod batch;
mod http;
mod kv;
mod policy;
mod tables;

#[psibase::service(name = "hostdb", tables = "tables::tables")]
mod service {
    use crate::http::{BatchSession, HostDbRequest, Route};
    use crate::kv::DeviceKv;
    use psibase::services::http_server::Wrapper as HttpServer;
    use psibase::*;
    use HttpStatus::{NoContent, NotFound};

    /// HTTP API for supervisor `host:db` storage.
    ///
    /// # Access
    ///
    /// - Use credentialed fetches. When the client sends `Origin`, responses echo
    ///   CORS for that value. Device and session cookies identify the client.
    ///
    /// # Cookies
    ///
    /// `Path=/; SameSite=Strict; Secure; HttpOnly`
    ///
    /// | Cookie | Description |
    /// |--------|-------------|
    /// | `__Host-HOSTDB-DEVICE` | 32-byte device id (hex); minted by `PUT /kv/device` when absent; scopes all keys |
    /// | `__Host-HOSTDB-SESSION` | `u32` session id; minted when absent on `PUT /kv/device` or session-scoped routes; scopes session keys |
    ///
    /// - An invalid device or session cookie yields `400` and no `Set-Cookie` on routes that use that cookie.
    /// - Any other read or write with no device cookie is `401` and sends no `Set-Cookie`.
    /// - A missing session cookie is minted only for `PUT /kv/device`, `GET /kv/session/...`, or batch ops with `"duration":"session"`.
    /// - Accepted ids (valid cookie or freshly minted) are sent back in `Set-Cookie`.
    ///
    /// # Routes
    ///
    /// `<key>` is the 32-byte storage key as hex.
    ///
    /// | | |
    /// |---|---|
    /// | `PUT /kv/device` | `204`. Mints the device when absent, refreshes it when present, and sets the session cookie |
    /// | `GET /kv/persistent/<key>` | `200` or `404`; `400` when `<key>` is invalid |
    /// | `GET /kv/session/<key>` | `200` or `404`; `400` when `<key>` is invalid, scoped to the session cookie |
    /// | `POST /kv/batch` | JSON batch (`Content-Type: application/json`); `204` on success. Session cookie required when any op has `"duration":"session"` |
    /// | `OPTIONS` on the paths above | CORS preflight; `204`. Allows `GET`, `POST`, `PUT`, and the requested headers |
    /// | anything else | `404` |
    ///
    /// # Batch body
    ///
    /// `{ "ops": [ ... ] }` (unknown fields rejected).
    ///
    /// ## Each op
    ///
    /// - `duration`: `"persistent"` | `"session"`
    /// - `key`: hex-encoded 32-byte storage key
    /// - `value` (optional): standard base64 ciphertext to store;
    ///   - JSON `null` deletes;
    ///   - when omitted, the op is check-only (no write)
    ///     - Check-only ops must include `expected`, or the batch returns `400`.
    /// - `expected` (optional): SHA-256 hex of the ciphertext a GET returned;
    ///   - JSON `null` if that GET was `404`;
    ///   - when omitted, the write or delete is unconditional
    ///
    /// ## Batch errors
    ///
    /// - Invalid JSON, oversize values, or other bad ops return `400` without writes.
    /// - An `expected` mismatch returns `409` without writes.
    #[action]
    #[allow(non_snake_case)]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        _user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(get_sender(), HttpServer::SERVICE, "[serveSys] unauthorized");
        Some(serve_sys_impl(request).unwrap_or_else(|e| e))
    }

    fn serve_sys_impl(request: HttpRequest) -> Result<HttpReply, HttpReply> {
        let (mut req, mut reply) = HostDbRequest::accept(&request)?;
        match req.take_route() {
            Route::CorsPreflight => Ok(reply.finish_with_status(NoContent)),
            Route::NotFound => Ok(reply.set_status(NotFound)),
            route => {
                let kv = DeviceKv::new(req.device());
                match route {
                    Route::PutDevice => {
                        let session = kv.session_id(req.session_cookie());
                        reply.set_session(session);
                        Ok(reply.finish_with_status(NoContent))
                    }
                    Route::GetPersistent(key) => {
                        Ok(reply.finish_with_body(kv.persistent_value(&key)))
                    }
                    Route::GetSession(key) => {
                        let session = kv.session_id(req.session_cookie());
                        reply.set_session(session);
                        Ok(reply.finish_with_body(kv.session_value(session, &key)))
                    }
                    Route::PostBatch(ops) => {
                        let session = match req.batch_session(&ops) {
                            BatchSession::NotNeeded => None,
                            BatchSession::Absent => Some(kv.session_id(None)),
                            BatchSession::Present(id) => Some(id),
                        };
                        if let Some(session) = session {
                            reply.set_session(session);
                        }
                        kv.apply_batch(session, ops)
                            .map_err(|status| reply.set_status(status))?;
                        Ok(reply.finish_with_status(NoContent))
                    }
                    Route::CorsPreflight | Route::NotFound => unreachable!(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
