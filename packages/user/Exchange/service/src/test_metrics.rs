//! Native-chain timing records, kept outside the financial implementation.
use psibase::{ChainEmptyResult, ChainResult, InnerTraceEnum, TransactionTrace};
use serde_json::{json, Value};
use std::time::Instant;

#[cfg(target_family = "wasm")]
#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    #[link_name = "clock_time_get"]
    fn cpu_clock_time_get(id: u32, precision: u64, timestamp: *mut u64) -> u16;
}

#[cfg(target_family = "wasm")]
fn cpu_time_ns(id: u32) -> u64 {
    let mut timestamp = 0;
    let error = unsafe { cpu_clock_time_get(id, 1, &mut timestamp) };
    assert_eq!(
        error, 0,
        "required WASI CPU clock {id} unavailable; rebuild psitest with CPU clock support"
    );
    timestamp
}

#[cfg(not(target_family = "wasm"))]
fn cpu_time_ns(_id: u32) -> u64 {
    panic!("Exchange CPU measurements require the psitest WASI CPU clock imports")
}

pub trait TraceRef {
    fn trace(&self) -> &TransactionTrace;
}
impl<T: psibase::fracpack::UnpackOwned> TraceRef for ChainResult<T> {
    fn trace(&self) -> &TransactionTrace {
        &self.trace
    }
}
impl TraceRef for ChainEmptyResult {
    fn trace(&self) -> &TransactionTrace {
        &self.trace
    }
}

pub fn measure<R: TraceRef>(scenario: &str, metadata: Value, f: impl FnOnce() -> R) -> R {
    // All readings bracket only f(), excluding trace walking and JSON output.
    // Nested clock reads add small measurement overhead to the CPU intervals.
    let process_start = cpu_time_ns(2);
    let thread_start = cpu_time_ns(3);
    let start = Instant::now();
    let result = f();
    let elapsed = start.elapsed().as_nanos();
    let thread_end = cpu_time_ns(3);
    let process_end = cpu_time_ns(2);
    let process_cpu = process_end
        .checked_sub(process_start)
        .expect("nonmonotone host process CPU clock");
    let thread_cpu = thread_end
        .checked_sub(thread_start)
        .expect("nonmonotone host thread CPU clock");
    let trace = result.trace();
    let billable: i128 = trace
        .action_traces
        .iter()
        .map(|a| a.total_time as i128)
        .sum();
    assert!(billable >= 0, "negative native action time");
    fn counts(a: &psibase::ActionTrace) -> (u64, u64) {
        let (mut all, mut exchange) = (1, u64::from(a.action.service == crate::SERVICE));
        for inner in &a.inner_traces {
            if let InnerTraceEnum::ActionTrace(child) = &inner.inner {
                let (ca, ce) = counts(child);
                all += ca;
                exchange += ce;
            }
        }
        (all, exchange)
    }
    let (all, exchange) = trace
        .action_traces
        .iter()
        .map(counts)
        .fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
    println!(
        "EXCHANGE_METRIC {}",
        json!({
            "scenario": scenario, "metadata": metadata, "wall_ns": elapsed.to_string(),
            "process_cpu_ns": process_cpu.to_string(), "thread_cpu_ns": thread_cpu.to_string(),
            "native_billable_ns": billable.to_string(), "inner_action_count": all,
            "exchange_action_count": exchange, "rejected": trace.error.is_some(),
            "clock_note": "Native watchdog: monotonic elapsed on macOS, thread CPU on Linux; excludes watchdog-paused work. wall_ns is end-to-end tester call.",
            "cpu_clock_note": "WASI clocks 2/3 sample host process/all-threads and calling-thread CPU around the tester call, including clock-read overhead; excludes later trace walking and metric output."
        })
    );
    result
}
