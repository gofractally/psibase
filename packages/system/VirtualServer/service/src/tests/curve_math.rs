use crate::tables::capacity_limit_pricing::Curve;

const MAX_RESERVES: u64 = 1_000_000;
const MAX_RESOURCES: u64 = 1_000_000;
const D: u64 = 10;

fn curve() -> Curve {
    Curve::new(MAX_RESERVES, MAX_RESOURCES, D)
}

#[test]
fn endpoints() {
    let c = curve();

    assert_eq!(c.pos_from_resources(0).reserves, MAX_RESERVES);
    assert_eq!(c.pos_from_resources(MAX_RESOURCES).reserves, 0);
}

#[test]
fn cost_increases() {
    let c = curve();
    let amount = 1000;

    let cost_low = c.pos_from_resources(800_000).cost_of(amount);
    let cost_high = c.pos_from_resources(200_000).cost_of(amount);

    assert!(
        cost_high > cost_low,
        "cost should increase as pool depletes: low={} high={}",
        cost_low,
        cost_high,
    );
}

#[test]
fn pool_capitalization() {
    let c = curve();

    for resources in [0, 1, 1000, 500_000, 999_999, MAX_RESOURCES] {
        let pos = c.pos_from_resources(resources);
        let xy = (pos.reserves as u128 + c.x0 as u128) * (resources as u128 + c.y0 as u128);
        assert!(
            xy >= c.k,
            "undercapitalized at resources={}: x*y={} < k={}",
            resources,
            xy,
            c.k,
        );
    }
}

#[test]
fn no_arbitrage() {
    let c = curve();

    for (remaining, amount) in [(MAX_RESOURCES, 1000), (500_000, 1000), (200_000, 10_000)] {
        let pos = c.pos_from_resources(remaining);
        let cost = pos.cost_of(amount);

        let after_buy = c.pos_from_resources(remaining - amount);
        let refund = after_buy.refund_of(amount);

        assert!(
            cost >= refund,
            "arbitrage at remaining={}: paid {} but got back {}",
            remaining,
            cost,
            refund,
        );
    }
}
