use psibase::{AccountNumber, Table, TimePointSec};

use crate::tables::tables::{Obligation, PairCycle, PairCycleTab};

impl PairCycle {
    fn save(&self) {
        PairCycleTab::read_write().put(self).unwrap();
    }

    fn erase(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) {
        PairCycleTab::read_write().erase(&(creditor, debtor, asset_id));
    }

    pub fn get(creditor: AccountNumber, debtor: AccountNumber, asset_id: u16) -> Option<Self> {
        PairCycleTab::read()
            .get_index_pk()
            .get(&(creditor, debtor, asset_id))
    }

    /// Update posted grace only. Never touches an open cycle snapshot.
    pub fn set_posted_grace(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        grace_seconds: u32,
    ) {
        if let Some(mut c) = Self::get(creditor, debtor, asset_id) {
            c.grace_seconds = grace_seconds;
            if grace_seconds == 0 && c.cycle_started_at.seconds == 0 {
                Self::erase(creditor, debtor, asset_id);
            } else {
                c.save();
            }
        } else if grace_seconds > 0 {
            Self {
                creditor,
                debtor,
                asset_id,
                grace_seconds,
                cycle_started_at: TimePointSec { seconds: 0 },
                cycle_grace_seconds: 0,
            }
            .save();
        }
    }

    pub fn in_grace_at(&self, now: TimePointSec) -> bool {
        if self.cycle_started_at.seconds == 0 || self.cycle_grace_seconds == 0 {
            return false;
        }
        let end = self
            .cycle_started_at
            .seconds
            .saturating_add(i64::from(self.cycle_grace_seconds));
        now.seconds < end
    }

    pub fn pair_in_grace(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        now: TimePointSec,
    ) -> bool {
        Self::get(creditor, debtor, asset_id)
            .map(|c| c.in_grace_at(now))
            .unwrap_or(false)
    }

    /// Open a cycle when the pair goes empty → occupied (if posted grace > 0);
    /// close when it is empty again. Occupied = any principal or stored
    /// interest. No-op when there is no row.
    pub fn sync_cycle(
        creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        before_clear: bool,
        after_clear: bool,
    ) {
        let Some(mut c) = Self::get(creditor, debtor, asset_id) else {
            return;
        };
        if before_clear && !after_clear && c.cycle_started_at.seconds == 0 {
            if c.grace_seconds == 0 {
                return;
            }
            c.cycle_started_at = Obligation::now();
            c.cycle_grace_seconds = c.grace_seconds;
            c.save();
        } else if after_clear && c.cycle_started_at.seconds != 0 {
            c.cycle_started_at = TimePointSec { seconds: 0 };
            c.cycle_grace_seconds = 0;
            if c.grace_seconds == 0 {
                Self::erase(creditor, debtor, asset_id);
            } else {
                c.save();
            }
        }
    }

    fn cycle_end(started: TimePointSec, grace_seconds: u32) -> i64 {
        started.seconds.saturating_add(i64::from(grace_seconds))
    }

    /// After a claim moves to a new creditor: keep the source remaining
    /// window (same end). Do not start the dest's posted grace — that
    /// would reset an already-aged claim.
    pub fn inherit_on_transfer(
        to_creditor: AccountNumber,
        debtor: AccountNumber,
        asset_id: u16,
        src: Option<&Self>,
        dest_occupied: bool,
        now: TimePointSec,
    ) {
        let src_in_grace = src.map(|c| c.in_grace_at(now)).unwrap_or(false);

        if dest_occupied {
            if !src_in_grace {
                return;
            }
            let src = src.unwrap();
            let src_end = Self::cycle_end(src.cycle_started_at, src.cycle_grace_seconds);
            let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) else {
                return;
            };
            if !dest.in_grace_at(now) {
                return;
            }
            let dest_end = Self::cycle_end(dest.cycle_started_at, dest.cycle_grace_seconds);
            if src_end <= dest_end {
                return;
            }
            dest.cycle_grace_seconds =
                u32::try_from(src_end.saturating_sub(dest.cycle_started_at.seconds))
                    .unwrap_or(u32::MAX);
            dest.save();
            return;
        }

        if src_in_grace {
            let src = src.unwrap();
            if let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) {
                dest.cycle_started_at = src.cycle_started_at;
                dest.cycle_grace_seconds = src.cycle_grace_seconds;
                dest.save();
            } else {
                Self {
                    creditor: to_creditor,
                    debtor,
                    asset_id,
                    grace_seconds: 0,
                    cycle_started_at: src.cycle_started_at,
                    cycle_grace_seconds: src.cycle_grace_seconds,
                }
                .save();
            }
        } else if let Some(mut dest) = Self::get(to_creditor, debtor, asset_id) {
            if dest.cycle_started_at.seconds != 0 {
                dest.cycle_started_at = TimePointSec { seconds: 0 };
                dest.cycle_grace_seconds = 0;
                if dest.grace_seconds == 0 {
                    Self::erase(to_creditor, debtor, asset_id);
                } else {
                    dest.save();
                }
            }
        }
    }
}
