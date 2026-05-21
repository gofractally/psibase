//! Optional server-side trace lines for websocket lifecycle debugging.
//!
//! Enable with `cargo build --features rt-trace` (off by default in production builds).

macro_rules! xrtcsig_trace {
    ($($arg:tt)*) => {{
        #[cfg(feature = "rt-trace")]
        {
            psibase::write_console(&format!($($arg)*));
        }
    }};
}

pub(crate) use xrtcsig_trace;
