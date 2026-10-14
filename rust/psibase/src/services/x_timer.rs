#[crate::service(name = "x-timer", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{MethodNumber, MonotonicTimePointUSec};

    /// Schedules a callback to be executed at the given time.
    /// The callback will be dropped silently if it has not been
    /// run before the current session ends.
    ///
    /// Returns the timer id. The timer id will be passed as
    /// the sole argument to the callback.
    ///
    /// This function may be called inside a subjective transaction
    #[action]
    fn runAt(time: MonotonicTimePointUSec, callback: MethodNumber) -> u64 {
        unimplemented!()
    }

    /// Cancels a timer callback. Returns true if cancellation
    /// was successful, or false if the callback has already
    /// started running.
    ///
    /// Only the creator of the timer can cancel it.
    ///
    /// This function may be called inside a subjective transaction
    #[action]
    fn cancel(id: u64) -> bool {
        unimplemented!()
    }

    // Internal callback
    #[action]
    fn runOne() {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
