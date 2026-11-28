//! The reporting window: 72 hours AND 1,000 deposits, one predicate for admission and retirement.
use btcbridge_core::*;

const HOUR: u64 = 3600;
const T0: u64 = 1_800_000_000;

/// The bridge's window state and the passive step its actions run, as the service does it.
struct Bridge {
    frontier: u32,
    deposits: u64,
    marks: Vec<Mark>,
    last_mark: Option<u32>,
    required: u32,
}
impl Bridge {
    fn new(required: u32) -> Self {
        Self { frontier: 0, deposits: 0, marks: vec![], last_mark: None, required }
    }
    /// One ordinary action at chain time `now` with the relay's tip at `tip`.
    fn step(&mut self, tip: u32, now: u64, deposited: bool) {
        if deposited {
            self.deposits += 1;
        }
        for _ in 0..2 {
            let Some(oldest) = self.marks.first().copied() else { break };
            let next = closed_frontier(self.frontier, &oldest, self.required, tip, now, self.deposits);
            assert!(next >= self.frontier, "the frontier never falls");
            self.frontier = next;
            if self.frontier >= mark_covers(&oldest, self.required) {
                self.marks.remove(0);
            } else {
                break;
            }
        }
        if mark_due(self.last_mark, self.marks.len() as u32, tip) {
            self.marks.push(Mark { height: tip, time: now, deposits: self.deposits });
            self.last_mark = Some(tip);
        }
    }
    fn open(&self, height: u32) -> bool {
        window_open(self.frontier, height)
    }
}

#[test]
fn both_conditions_are_needed_whichever_comes_later() {
    assert_eq!((WINDOW_SECONDS, WINDOW_DEPOSITS, REORG_MARGIN), (72 * HOUR, 1000, 144));
    let mark = Mark { height: 333_000, time: T0, deposits: 50 };
    // Time alone, or deposits alone, closes nothing.
    assert!(!mark_closed(&mark, T0 + 1000 * HOUR, 1049));
    assert!(!mark_closed(&mark, T0 + 72 * HOUR - 1, 5000));
    // The boundary of each, with the other satisfied.
    assert!(mark_closed(&mark, T0 + 72 * HOUR, 1050));
    assert!(!mark_closed(&mark, T0 + 72 * HOUR - 1, 1050));
    assert!(!mark_closed(&mark, T0 + 72 * HOUR, 1049));
    // Deposits first, then time; time first, then deposits: closed when the later one arrives.
    assert!(!mark_closed(&mark, T0 + 10 * HOUR, 1050) && mark_closed(&mark, T0 + 72 * HOUR, 1050));
    assert!(!mark_closed(&mark, T0 + 500 * HOUR, 60) && mark_closed(&mark, T0 + 500 * HOUR, 1050));
}

#[test]
fn the_frontier_only_rises_and_stays_clear_of_the_tip() {
    let mark = Mark { height: 1000, time: T0, deposits: 0 };
    let closed = (T0 + 72 * HOUR, 1000);
    // Not closed: unchanged.
    assert_eq!(closed_frontier(7, &mark, 1, 5000, T0, 1000), 7);
    // Closed, tip far ahead: everything the mark covers. With six confirmations required, a
    // block was reportable only when the tip was five above it.
    assert_eq!(closed_frontier(0, &mark, 1, 5000, closed.0, closed.1), 1000);
    assert_eq!(closed_frontier(0, &mark, 6, 5000, closed.0, closed.1), 995);
    assert_eq!((mark_covers(&mark, 1), mark_covers(&mark, 6)), (1000, 995));
    // Never within 144 blocks of the tip: a relay that barely moved closes less.
    assert_eq!(closed_frontier(0, &mark, 1, 1100, closed.0, closed.1), 956);
    assert_eq!(closed_frontier(0, &mark, 1, 1144, closed.0, closed.1), 1000);
    assert_eq!(closed_frontier(0, &mark, 1, 100, closed.0, closed.1), 0);
    // Never falls, whatever it is shown later.
    assert_eq!(closed_frontier(2000, &mark, 1, 5000, closed.0, closed.1), 2000);
    assert_eq!(closed_frontier(990, &mark, 1, 1100, closed.0, closed.1), 990);
    // The predicate.
    assert!(window_open(1000, 1001) && !window_open(1000, 1000) && !window_open(1000, 1));
    assert!(window_open(0, 1));
}

#[test]
fn a_busy_chain_closes_windows_after_three_days_and_a_thousand_deposits() {
    let mut b = Bridge::new(1);
    // An hour of blocks at a time; forty deposits an hour.
    let (mut tip, mut now) = (333_000u32, T0);
    let deposit_block = tip; // a deposit confirmed here is reportable from the first step
    let mut closed_at = None;
    for hour in 0..200u64 {
        for n in 0..40 {
            b.step(tip, now + n * 60, true);
        }
        if closed_at.is_none() && !b.open(deposit_block) {
            closed_at = Some(hour);
        }
        tip += 6;
        now += HOUR;
    }
    // 1,000 deposits took 25 hours; the 72 hours were the later condition. The window closed in
    // the first action after both held.
    assert_eq!(closed_at, Some(72));
    // Marks are deleted as they close: about three days' worth are kept, not two hundred.
    assert!(b.marks.len() <= 74, "{}", b.marks.len());
    // The frontier trails real time by the window and never reaches the reorganization margin.
    assert!(b.frontier <= tip - REORG_MARGIN);
    assert!(b.frontier >= tip - 6 * 75);
    // Open and closed are one line: every block above the frontier is open.
    assert!(b.open(b.frontier + 1) && !b.open(b.frontier));
}

#[test]
fn a_slow_trickle_of_deposits_keeps_windows_open_past_the_time() {
    let mut b = Bridge::new(1);
    let (mut tip, mut now) = (333_000u32, T0);
    let block = tip;
    // Two deposits an hour: 1,000 take 500 hours.
    let mut closed_at = None;
    for hour in 0..600u64 {
        b.step(tip, now, true);
        b.step(tip, now + 1800, true);
        if closed_at.is_none() && !b.open(block) {
            closed_at = Some(hour);
        }
        tip += 6;
        now += HOUR;
    }
    assert_eq!(closed_at, Some(500));
}

#[test]
fn on_a_quiet_chain_nothing_ever_closes() {
    // psiber.net today: one credited deposit, a relay that follows the tip, occasional actions.
    let mut b = Bridge::new(1);
    let (mut tip, mut now) = (332_753u32, T0);
    b.step(tip, now, true);
    for _ in 0..(24 * 365) {
        tip += 6;
        now += HOUR;
        b.step(tip, now, false);
    }
    assert_eq!(b.frontier, 0);
    assert!(b.open(332_753) && b.open(1));
    // The marks are bounded: when full none is added, and the uncovered blocks stay open.
    assert_eq!(b.marks.len() as u32, MAX_MARKS);
    assert!(!mark_due(b.last_mark, MAX_MARKS, tip + 1000));
    // Proof of life arrives: 999 more deposits are not enough, the 1,000th closes the old window.
    for n in 0..999 {
        b.step(tip, now + n, true);
    }
    assert!(b.open(332_753));
    b.step(tip, now + 999, true);
    assert!(!b.open(332_753));
    // ... and only that mark's blocks, not everything: the next mark has its own count.
    assert!(b.open(332_753 + 6 + 1));
}

#[test]
fn marks_follow_the_relay_and_a_late_start_only_lengthens_a_window() {
    assert_eq!((MARK_SPACING, MAX_MARKS), (6, 512));
    assert!(mark_due(None, 0, 100));
    assert!(!mark_due(Some(100), 1, 105) && mark_due(Some(100), 1, 106));
    // A tip that fell back after a reorganization is not marked again until it has passed the last mark.
    assert!(!mark_due(Some(100), 1, 90));
    assert!(!mark_due(Some(100), MAX_MARKS, 10_000));
    // The relay was down for a week, then caught up 1,008 blocks in minutes. No window opened
    // while it was down, and the clock of the blocks it brought starts when the bridge saw them.
    let mut b = Bridge::new(1);
    let (tip, now) = (333_000u32, T0);
    b.step(tip, now, true);
    let later = now + 7 * 24 * HOUR;
    b.step(tip + 1008, later, true);
    for n in 0..2000 {
        b.step(tip + 1008, later + n, true);
    }
    // Plenty of deposits, but not 72 hours since the bridge first saw those blocks.
    assert!(b.open(tip + 1) && b.open(tip + 1008));
    // The block at the old tip had its 72 hours and its thousand deposits.
    assert!(!b.open(tip));
    b.step(tip + 1008 + 432, later + 72 * HOUR, false);
    assert!(!b.open(tip + 1008));
}

#[test]
fn nothing_closed_can_be_reorganized_and_nothing_reopens() {
    // The relay's tip mostly advances and, in a reorganization, falls back by at most its
    // 128-block bound below the highest tip it has shown. Whatever the sequence of tips, times
    // and deposits: the frontier never falls (checked in `step`), and it stays 144 below the
    // highest tip, so below every height a reorganization can touch.
    const RELAY_REORG_BOUND: u32 = 128;
    assert!(REORG_MARGIN > RELAY_REORG_BOUND);
    let mut b = Bridge::new(6);
    let mut highest = 10_000u32;
    let mut now = T0;
    for round in 0..5000u32 {
        let tip = if round % 37 == 36 {
            highest - (round % (RELAY_REORG_BOUND + 1))
        } else {
            highest += round % 4;
            highest
        };
        now += 600 * (1 + (round % 5) as u64);
        b.step(tip, now, round % 3 != 0);
        assert!(b.frontier + REORG_MARGIN <= highest || b.frontier == 0);
        // The lowest block a reorganization could replace now is above the frontier.
        assert!(b.frontier < highest - RELAY_REORG_BOUND);
    }
    assert!(b.frontier > 10_000, "the frontier advanced in this run");
}
