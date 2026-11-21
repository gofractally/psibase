use super::*;
use psibase::account;
fn line(id: u64, a: AccountNumber, b: AccountNumber) -> Line {
    let (_, low, high) = pair_key("USD", a, b);
    Line {
        id,
        symbol: "USD".into(),
        low,
        high,
        low_limit: 1000,
        high_limit: 1000,
        balance: 0,
        low_fee: 10000,
        high_fee: 10000,
        low_forward: true,
        high_forward: true,
        revision: 1,
    }
}
fn sample() -> (Envelope, Vec<Line>) {
    let a = account!("alice");
    let b = account!("bob");
    let c = account!("carol");
    let lines = vec![line(1, a, b), line(2, b, c)];
    let context = Context {
        version: 1,
        epoch: 1,
        payer: a.to_string(),
        payee: c.to_string(),
        symbol: "USD".into(),
        amount: 100,
        total: 101,
        expires_at: 123,
        reference: "sample-reference".into(),
        request: None,
    };
    let encoded = Envelope::seal(
        &[42; 32],
        context,
        &[
            (
                a.to_string(),
                Hop {
                    line: 1,
                    amount: 101,
                    revision: 1,
                    end: false,
                },
            ),
            (
                b.to_string(),
                Hop {
                    line: 2,
                    amount: 100,
                    revision: 1,
                    end: true,
                },
            ),
        ],
        &[17; 360],
    )
    .unwrap();
    (Envelope::parse(&encoded).unwrap(), lines)
}
fn validate(e: &Envelope, lines: &[Line]) -> Result<Vec<Transfer>, &'static str> {
    validate_route(e, &[42; 32], |id| {
        lines.iter().find(|l| l.id == id).cloned()
    })
}
#[test]
fn execution_reads_only_route_rows() {
    let (e, lines) = sample();
    let mut reads = 0;
    let t = validate_route(&e, &[42; 32], |id| {
        reads += 1;
        lines.iter().find(|l| l.id == id).cloned()
    })
    .unwrap();
    assert_eq!(reads, 2);
    assert_eq!(t.len(), 2);
    assert_eq!(t[0].amount - t[1].amount, 1);
}
#[test]
fn changed_credit_settings_invalidate_quote() {
    let (e, mut lines) = sample();
    lines[1].revision += 1;
    assert!(validate(&e, &lines).is_err());
}
#[test]
fn insufficient_current_capacity_invalidates_quote() {
    let (e, mut lines) = sample();
    lines[0].low_limit = 0;
    lines[0].high_limit = 0;
    assert!(validate(&e, &lines).is_err());
}
#[test]
fn forwarding_pause_invalidates_quote() {
    let (e, mut lines) = sample();
    lines[1].low_forward = false;
    lines[1].high_forward = false;
    assert!(validate(&e, &lines).is_err());
}
#[test]
fn current_fees_are_verified_even_with_same_revision() {
    let (e, mut lines) = sample();
    lines[1].low_fee = 20000;
    lines[1].high_fee = 20000;
    assert!(validate(&e, &lines).is_err());
}
#[test]
fn symbol_substitution_rejected() {
    let (e, mut lines) = sample();
    lines[1].symbol = "BTC".into();
    assert!(validate(&e, &lines).is_err());
}
#[test]
fn missing_row_is_generic_failure() {
    let (e, lines) = sample();
    assert_eq!(validate(&e, &lines[..1]).unwrap_err(), INVALID);
}
#[test]
fn one_sided_credit_and_reverse_repayment() {
    let a = account!("alice");
    let b = account!("bob");
    let mut l = line(1, a, b);
    l.low_limit = 100;
    l.high_limit = 0;
    assert_eq!(capacity(&l, l.low), 0);
    assert_eq!(capacity(&l, l.high), 100);
    l.balance = 5;
    assert_eq!(capacity(&l, l.low), 5);
    assert_eq!(capacity(&l, l.high), 95);
    l.low_limit = 0;
    assert_eq!(capacity(&l, l.high), 0);
    assert_eq!(capacity(&l, l.low), 5);
}
#[test]
fn rejects_authenticated_but_invalid_route_structure() {
    let (e, lines) = sample();
    let a = &e.context.payer;
    let b = account!("bob").to_string();
    for hops in [
        vec![(
            a.clone(),
            Hop {
                line: 1,
                amount: 101,
                revision: 1,
                end: true,
            },
        )],
        vec![
            (
                a.clone(),
                Hop {
                    line: 1,
                    amount: 100,
                    revision: 1,
                    end: false,
                },
            ),
            (
                b.clone(),
                Hop {
                    line: 2,
                    amount: 100,
                    revision: 1,
                    end: true,
                },
            ),
        ],
        vec![
            (
                a.clone(),
                Hop {
                    line: 1,
                    amount: 101,
                    revision: 1,
                    end: false,
                },
            ),
            (
                b.clone(),
                Hop {
                    line: 1,
                    amount: 100,
                    revision: 1,
                    end: true,
                },
            ),
        ],
    ] {
        let encoded = Envelope::seal(&[42; 32], e.context.clone(), &hops, &[7; 360]).unwrap();
        assert!(validate(&Envelope::parse(&encoded).unwrap(), &lines).is_err());
    }
}
#[test]
fn crypto_benchmark_seven_hops() {
    let names = ["alice", "bob", "carol", "dan", "erin", "frank", "grace"];
    let mut c = sample().0.context;
    c.payee = "heidi".into();
    c.total = 100;
    let hops: Vec<_> = names
        .iter()
        .enumerate()
        .map(|(i, n)| {
            (
                n.to_string(),
                Hop {
                    line: i as u64 + 1,
                    amount: 100,
                    revision: 1,
                    end: i == 6,
                },
            )
        })
        .collect();
    let encoded = Envelope::seal(&[42; 32], c, &hops, &[17; 360]).unwrap();
    let envelope = Envelope::parse(&encoded).unwrap();
    let start = std::time::Instant::now();
    for _ in 0..1000 {
        envelope.authenticate(&[42; 32]).unwrap();
        for (i, n) in names.iter().enumerate() {
            std::hint::black_box(envelope.open(&[42; 32], n, i).unwrap());
        }
    }
    eprintln!("Seven-hop authentication + decryption: {:?} per payment (native debug; WASM benchmark separately required)",start.elapsed()/1000);
}
