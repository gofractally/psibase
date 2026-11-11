use psibase::TimePointSec;

pub(crate) const DEVICE_COOKIE: &str = "__Host-HOSTDB-DEVICE";
pub(crate) const SESSION_COOKIE: &str = "__Host-HOSTDB-SESSION";

pub(crate) const DEVICE_ID_LEN: usize = 32;
pub(crate) const SESSION_ID_LEN: usize = 16;

/// Storage key length (32-byte HMAC digest on the wire as hex).
pub(crate) const KEY_LEN: usize = 32;

/// 100 KB plaintext plus the 12-byte nonce and 16-byte GCM tag `host:db` stores.
pub(crate) const MAX_VALUE_LEN: usize = 100 * 1024 + 28;

const DAY_SECS: u64 = 24 * 60 * 60;

/// Idle window before device rows and the device cookie expire.
pub(crate) const DEVICE_RETENTION_SECS: u64 = 400 * DAY_SECS;

/// Idle window before session rows and the session cookie expire.
pub(crate) const SESSION_RETENTION_SECS: u64 = 7 * DAY_SECS;

/// Earliest block time that is still inside `retention_secs` of `now`.
pub(crate) fn idle_cutoff(now: TimePointSec, retention_secs: u64) -> TimePointSec {
    TimePointSec {
        seconds: now.seconds.saturating_sub(retention_secs as i64),
    }
}
