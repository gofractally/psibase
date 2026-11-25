//! Explicit trust hierarchy, independent of generated enum Ord implementations.
pub fn at_least(granted: u8, requested: u8) -> bool {
    // Values come only from the exhaustive typed TrustLevel conversion.
    assert!(granted <= 4 && requested <= 4, "invalid trust rank");
    granted >= requested
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_twenty_five_authorization_pairs_preserve_the_explicit_hierarchy() {
        // Rows: granted None/Low/Medium/High/Max; columns: requested level.
        let allowed = [
            [true, false, false, false, false],
            [true, true, false, false, false],
            [true, true, true, false, false],
            [true, true, true, true, false],
            [true, true, true, true, true],
        ];
        for (granted, row) in allowed.iter().enumerate() {
            for (requested, expected) in row.iter().enumerate() {
                assert_eq!(at_least(granted as u8, requested as u8), *expected);
            }
        }
    }
    #[test]
    fn session_and_persistent_combination_never_reduces_or_adds_trust() {
        for session in 0..=4u8 {
            for persistent in 0..=4u8 {
                let combined = if at_least(session, persistent) {
                    session
                } else {
                    persistent
                };
                for requested in 0..=4u8 {
                    assert_eq!(
                        at_least(combined, requested),
                        at_least(session, requested) || at_least(persistent, requested)
                    );
                }
            }
        }
    }
    #[test]
    #[should_panic(expected = "invalid trust rank")]
    fn unknown_rank_cannot_authorize() {
        at_least(255, 3);
    }
}
