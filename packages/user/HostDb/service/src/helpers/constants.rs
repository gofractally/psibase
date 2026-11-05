pub(crate) const DEVICE_COOKIE: &str = "__Host-HOSTDB-DEVICE";
pub(crate) const SESSION_COOKIE: &str = "__Host-HOSTDB-SESSION";
pub(crate) const ID_LEN: usize = 16;
pub(crate) const KEY_LEN: usize = 32;
/// 100 KB plaintext plus the 12-byte nonce and 16-byte GCM tag `host:db` stores.
pub(crate) const MAX_VALUE_LEN: usize = 100 * 1024 + 28;
pub(crate) const NS_PER_SEC: u64 = 1_000_000_000;
pub(crate) const DAY_SECS: u64 = 24 * 60 * 60;
/// Device cookie `Max-Age`.
pub(crate) const DEVICE_MAX_AGE_SECS: u64 = 400 * DAY_SECS;
pub(crate) const DEVICE_IDLE_NS: u64 = DEVICE_MAX_AGE_SECS * NS_PER_SEC;
/// `__WASI_CLOCKID_REALTIME`: wall-clock nanoseconds since the unix epoch.
pub(crate) const CLOCK_REALTIME: u32 = 0;
pub(crate) const SESSION_IDLE_NS: u64 = 7 * DAY_SECS * NS_PER_SEC;
pub(crate) const GC_LIMIT: usize = 16;

use psibase::native_raw;
use psibase::*;

pub(crate) fn wall_time_ns() -> u64 {
    let mut time = 0u64;
    let err = unsafe { native_raw::clockTimeGet(CLOCK_REALTIME, &mut time) };
    if err != 0 {
        abort_message("clockTimeGet failed");
    }
    time
}
