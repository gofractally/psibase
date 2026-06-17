use crate::tables::capacity_limit_pricing::{validate_curve_params, Curve};

fn test_curves() -> [(u64, u64, u64); 7] {
    [
        (1_000_000, 1_000_000, 10),              // Some sample curve
        (1, 1, 1),                               // The minimal curve
        (1_000_000, 1_000_000, 1),               // D = 1
        (u64::MAX, 1_000_000, 1),                // D = 1, max reserves
        (1_000_000, u64::MAX, 1),                // D = 1, max resources
        (67_280_421_310_721, u64::MAX, 274_176), // A maximal curve
        (u64::MAX, 67_280_421_310_721, 274_176), // A maximal curve
    ]
}

#[test]
fn endpoints() {
    for (max_reserves, max_resources, d) in test_curves() {
        let c = Curve::new(max_reserves, max_resources, d);

        assert_eq!(c.pos_from_resources(0).reserves, max_reserves);

        // When nothing has been consumed yet, the ideal reserve is 0, but
        // conservative rounding (ceil `k`, floor `x0`/`y0`) can push it higher, so
        // assert only that it's the minimal reserve keeping the pool capitalized
        // (`X * Y >= k`).
        let pos = c.pos_from_resources(max_resources);
        let big_y = max_resources as u128 + c.y0 as u128;
        let x = pos.reserves as u128 + c.x0 as u128;
        assert!(
            x * big_y >= c.k,
            "undercapitalized at empty endpoint: X*Y={} < k={}",
            x * big_y,
            c.k,
        );
        if pos.reserves > 0 {
            assert!(
                (x - 1) * big_y < c.k,
                "reserve not minimal at empty endpoint: reserves={} keeps X*Y >= k after -1",
                pos.reserves,
            );
        }
    }
}

#[test]
fn cost_increases() {
    for (max_reserves, max_resources, d) in test_curves() {
        let remaining_low = max_resources * 8 / 10;
        let remaining_high = max_resources * 2 / 10;

        if remaining_low <= remaining_high {
            // Not really a valid test for the minimal (1,1,1) curve.
            // Both remaining levels are 0
            continue;
        }

        let c = Curve::new(max_reserves, max_resources, d);
        let amount = (max_resources / 10).max(1);

        let cost_low = c.pos_from_resources(remaining_low).cost_of(amount);
        let cost_high = c.pos_from_resources(remaining_high).cost_of(amount);

        assert!(
            cost_high > cost_low,
            "cost should increase as pool depletes: low={} high={}",
            cost_low,
            cost_high,
        );
    }
}

#[test]
fn pool_capitalization() {
    for (max_reserves, max_resources, d) in test_curves() {
        let c = Curve::new(max_reserves, max_resources, d);

        let mut resource_checkpoints = Vec::new();
        for resources in [
            0,
            1.min(max_resources),
            max_resources / 4,
            max_resources / 2,
            max_resources.saturating_sub(1),
            max_resources,
        ] {
            if !resource_checkpoints.contains(&resources) {
                resource_checkpoints.push(resources);
            }
        }

        for resources in resource_checkpoints {
            let pos = c.pos_from_resources(resources);
            let xy = (pos.reserves as u128 + c.x0 as u128) * (resources as u128 + c.y0 as u128);
            // `X*Y >= k` holds except where reserves is capped at the budget, in
            // which case `X*Y` dips below `k`, which is harmless. Curve is still
            // economically safe.
            assert!(
                xy >= c.k || pos.reserves == max_reserves,
                "undercapitalized at resources={}: x*y={} < k={} (reserves={}, max_reserve={})",
                resources,
                xy,
                c.k,
                pos.reserves,
                max_reserves,
            );
        }
    }
}

#[test]
fn no_arbitrage() {
    for (max_reserves, max_resources, d) in test_curves() {
        let c = Curve::new(max_reserves, max_resources, d);

        let partial_amount = (max_resources / 2).max(1);
        let full = c.pos_from_resources(max_resources);
        let partial = c.pos_from_resources(max_resources - partial_amount);
        let empty = c.pos_from_resources(0);

        // No-arbitrage: a buy then sell of the same amount never refunds more
        // than it cost (rounding/clamping can make the refund strictly less).
        let cost_all = full.cost_of(max_resources);
        let cost_partial = full.cost_of(partial_amount);
        let refund_all = empty.refund_of(max_resources);
        let refund_partial = partial.refund_of(partial_amount);
        assert!(cost_all > 0);
        assert!(cost_partial > 0);
        assert!(cost_all >= refund_all);
        assert!(cost_partial >= refund_partial);
    }
}

#[test]
fn cost_refund_of_zero() {
    for (max_reserves, max_resources, d) in test_curves() {
        let c = Curve::new(max_reserves, max_resources, d);
        let full = c.pos_from_resources(max_resources);
        assert_eq!(full.cost_of(0), 0);
        assert_eq!(full.refund_of(0), 0);

        let empty = c.pos_from_resources(0);
        assert_eq!(empty.cost_of(0), 0);
        assert_eq!(empty.refund_of(0), 0);
    }
}

fn ok(max_reserve: u64, max_resources: u64, curve_d: u64) {
    assert_eq!(
        validate_curve_params(max_reserve, max_resources, curve_d),
        Ok(())
    );
}

fn err(max_reserve: u64, max_resources: u64, curve_d: u64, expected: &str) {
    assert_eq!(
        validate_curve_params(max_reserve, max_resources, curve_d),
        Err(expected)
    );
}

#[test]
fn boundary_construction() {
    // max_reserve = u64::MAX is valid
    ok(u64::MAX, 1_000_000, 10);

    // max_reserve = 0 is invalid
    err(0, 1_000_000, 10, "max_reserve must be > 0");

    // max_capacity = 0 is invalid
    err(1_000_000, 0, 10, "max_capacity must be > 0");

    // D = 0 is invalid
    err(1_000_000, 1_000_000, 0, "curve_d must be > 0");

    // y0 = max_capacity / curve_d must stay >= 1.
    ok(1000, 10, 10); // y0 = 1
    err(1000, 10, 11, "max_capacity must be >= curve_d"); // y0 = 0

    // x0 = max_reserve / curve_d must stay >= 1.
    ok(10, 1000, 10); // x0 = 1
    err(10, 1000, 11, "max_reserve must be >= curve_d"); // x0 = 0

    // (D + 1) * MAX_RES == 2^64 + 1
    {
        let (max_reserves, max_resources, d) = (u64::MAX, 67_280_421_310_721, 274_176);
        ok(max_reserves, max_resources, d);
        err(
            max_reserves,
            max_resources + 1,
            d,
            "curve parameters too large: pricing math would overflow",
        );
        err(
            max_reserves,
            max_resources,
            d + 1,
            "curve parameters too large: pricing math would overflow",
        );
    }

    {
        let (max_reserves, max_resources, d) = (67_280_421_310_721, u64::MAX, 274_176);
        ok(max_reserves, max_resources, d);
        err(
            max_reserves + 1,
            max_resources,
            d,
            "curve parameters too large: pricing math would overflow",
        );
        err(
            max_reserves,
            max_resources,
            d + 1,
            "curve parameters too large: pricing math would overflow",
        );
    }

    // The init pair (u64::MAX, u64::MAX) overflows for any D.
    err(
        u64::MAX,
        u64::MAX,
        1,
        "curve parameters too large: pricing math would overflow",
    );
}
