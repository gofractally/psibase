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
    /// - `Origin` must name `supervisor.{root}` for the request host; otherwise `403`.
    /// - Use credentialed fetches. Responses echo CORS for the accepted origin.
    ///
    /// # Cookies
    ///
    /// `Path=/; SameSite=Strict; Secure; HttpOnly`
    ///
    /// | Cookie | Description |
    /// |--------|-------------|
    /// | `__Host-HOSTDB-DEVICE` | 32-byte device id (hex); minted when absent; scopes all keys |
    /// | `__Host-HOSTDB-SESSION` | decimal session id from the device's counter; minted when absent on session-scoped routes; scopes session keys |
    ///
    /// - A device cookie with bad hex or length, or a session cookie that is not a decimal integer without leading zeros, yields `400` on routes that use that cookie.
    /// - A missing device cookie causes a new device id to be minted.
    /// - A missing session cookie is minted only for `GET /kv/session/...` or batch ops with `"duration":"session"`,
    /// - Accepted ids (valid cookie or freshly minted) are sent back in `Set-Cookie`.
    ///
    /// # Routes
    ///
    /// `<key>` is the 32-byte storage key as hex.
    ///
    /// | | |
    /// |---|---|
    /// | `GET /kv/persistent/<key>` | `200` or `404`; `400` when `<key>` is invalid |
    /// | `GET /kv/session/<key>` | `200` or `404`; `400` when `<key>` is invalid, scoped to the session cookie |
    /// | `POST /kv/batch` | JSON batch (`Content-Type: application/json`); `204` on success. Session cookie required when any op has `"duration":"session"` |
    /// | `OPTIONS` on the paths above | CORS preflight; `204` |
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
        let root = HttpServer::call().rootHost(request.host.clone());
        let (mut req, mut reply) = HostDbRequest::accept(&request, &root)?;
        let kv = DeviceKv::new(req.device());
        match req.take_route() {
            Route::CorsPreflight => {
                reply.set_preflight(req.http());
                Ok(reply.finish_with_status(NoContent))
            }
            Route::GetPersistent(key) => Ok(reply.finish_with_body(kv.persistent_value(&key))),
            Route::GetSession(key) => {
                let session = kv.session_id(
                    req.session_cookie()
                        .map_err(|status| reply.set_status(status))?,
                );
                reply.set_session(session);
                Ok(reply.finish_with_body(kv.session_value(session, &key)))
            }
            Route::PostBatch(ops) => {
                let session = match req
                    .batch_session(&ops)
                    .map_err(|status| reply.set_status(status))?
                {
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
            Route::NotFound => Ok(reply.set_status(NotFound)),
        }
    }
}

#[cfg(test)]
mod tests;
