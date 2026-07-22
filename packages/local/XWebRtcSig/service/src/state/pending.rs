use psibase::AccountNumber;
use psibase::Table;

use super::tables::{
    SigPendingOutboundRow, SigPendingOutboundTable, SigPendingSignalRow, SigPendingSignalTable,
};

pub fn enqueue_pending_signal(session_id: &str, to: AccountNumber, seq: i64, payload: String) {
    // Block time microseconds collide for signals enqueued in the same block.
    // Push past the highest existing seq so the FIFO ordering of the queue
    // (offer → ICE candidates) survives `drain_pending_signals`.
    // `Iterator::last` on `TableIter` reverse-seeks the highest PK (same idea as
    // XRun/Events). Do not use `.map(...).max()` (full scan) or `.max()` (needs Ord).
    let lo = (session_id.to_owned(), to, i64::MIN);
    let hi = (session_id.to_owned(), to, i64::MAX);
    let max_existing = SigPendingSignalTable::read()
        .get_index_pk()
        .range(lo..=hi)
        .last()
        .map(|row| row.seq);
    let next_seq = next_pending_seq(max_existing, seq);
    SigPendingSignalTable::new()
        .put(&SigPendingSignalRow {
            session_id: session_id.to_owned(),
            to,
            seq: next_seq,
            payload,
        })
        .unwrap();
}

/// Pure seq bump for pending FIFO when multiple items share a block time.
pub fn next_pending_seq(max_existing: Option<i64>, block_seq: i64) -> i64 {
    match max_existing {
        Some(prev) if prev >= block_seq => prev + 1,
        _ => block_seq,
    }
}

pub fn drain_pending_signals(session_id: &str, to: AccountNumber) -> Vec<String> {
    let table = SigPendingSignalTable::new();
    let read = SigPendingSignalTable::read();
    let lo = (session_id.to_owned(), to, i64::MIN);
    let hi = (session_id.to_owned(), to, i64::MAX);
    let rows: Vec<SigPendingSignalRow> = read.get_index_pk().range(lo..=hi).collect();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        table.erase(&(row.session_id, row.to, row.seq));
        out.push(row.payload);
    }
    out
}

pub fn enqueue_pending_outbound(target_socket: i32, seq: i64, payload: String) {
    let lo = (target_socket, i64::MIN);
    let hi = (target_socket, i64::MAX);
    let max_existing = SigPendingOutboundTable::read()
        .get_index_pk()
        .range(lo..=hi)
        .last()
        .map(|row| row.seq);
    let next_seq = next_pending_seq(max_existing, seq);
    SigPendingOutboundTable::new()
        .put(&SigPendingOutboundRow {
            target_socket,
            seq: next_seq,
            payload,
        })
        .unwrap();
}

pub fn drain_pending_outbound(target_socket: i32) -> Vec<String> {
    let table = SigPendingOutboundTable::new();
    let read = SigPendingOutboundTable::read();
    let lo = (target_socket, i64::MIN);
    let hi = (target_socket, i64::MAX);
    let rows: Vec<SigPendingOutboundRow> = read.get_index_pk().range(lo..=hi).collect();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        table.erase(&(row.target_socket, row.seq));
        out.push(row.payload);
    }
    out
}

pub fn clear_pending_outbound(target_socket: i32) {
    let table = SigPendingOutboundTable::new();
    let lo = (target_socket, i64::MIN);
    let hi = (target_socket, i64::MAX);
    for row in SigPendingOutboundTable::read()
        .get_index_pk()
        .range(lo..=hi)
        .collect::<Vec<_>>()
    {
        table.erase(&(row.target_socket, row.seq));
    }
}

pub fn session_clear_pending_signals(session_id: &str) {
    let table = SigPendingSignalTable::new();
    let rows: Vec<SigPendingSignalRow> = SigPendingSignalTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .collect();
    for row in rows {
        table.erase(&(row.session_id, row.to, row.seq));
    }
}
