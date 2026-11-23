//! Exercise the real native indexes above the old global 100/1,000 limits.
//! Rows are created through financial actions; fixture setup is not timed.
use super::*;

use std::collections::BTreeSet;

fn batch(chain: &Chain, actions: Vec<Action>) -> Result<(), Error> {
    for chunk in actions.chunks(16) {
        // Native duplicate-transaction protection also applies to identical
        // fixture batches. Advance deterministically, as ChainPusher does.
        chain.start_block();
        let mut transaction = Transaction {
            tapos: Default::default(),
            actions: chunk.to_vec(),
            claims: vec![],
        };
        chain.fill_tapos(&mut transaction, 30);
        ChainEmptyResult {
            trace: chain.push(&SignedTransaction {
                transaction: psio::pssz::Nested::new(&transaction).unwrap(),
                proofs: vec![],
                subjectiveData: None,
            }),
        }
        .get()?;
    }
    Ok(())
}

fn get(chain: &Chain, token: Option<&str>, path: &str) -> Result<Value, Error> {
    let response = match token {
        Some(token) => chain.get_auth(crate::SERVICE, path, token)?,
        None => chain.get(crate::SERVICE, path)?,
    };
    assert_eq!(
        response.status,
        200,
        "{path}: {}",
        String::from_utf8_lossy(&response.body)
    );
    if token.is_some() {
        assert!(response
            .headers
            .iter()
            .any(|h| h.name.eq_ignore_ascii_case("Cache-Control") && h.value == "no-store"));
    }
    Ok(serde_json::from_slice(&response.body)?)
}

/// Seek cursors are opaque strings; only the market discovery cursor is numeric.
fn cursor(page: &Value) -> Option<String> {
    match &page["next_after"] {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        n => Some(n.to_string()),
    }
}

fn pages(
    chain: &Chain,
    token: Option<&str>,
    path: &str,
    field: &str,
    expected: usize,
) -> Result<Vec<Value>, Error> {
    let mut after = None;
    let mut all = vec![];
    let mut cursors = BTreeSet::new();
    loop {
        let url = format!(
            "{path}&limit=73{}",
            after
                .as_ref()
                .map(|s| format!("&after={s}"))
                .unwrap_or_default()
        );
        let page = get(chain, token, &url)?;
        let rows = page[field].as_array().expect("page rows");
        assert!(rows.len() <= 73);
        if token.is_some() && field == "rows" {
            for row in rows {
                assert_eq!(row["owner"], page["owner"]);
                assert!(
                    page["markets"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|m| m["id"] == row["market"]),
                    "missing referenced market"
                );
            }
        }
        all.extend(rows.iter().cloned());
        after = cursor(&page);
        let Some(next) = &after else { break };
        assert!(cursors.insert(next.clone()), "nonadvancing page cursor");
        assert!(all.len() <= expected, "too many rows or cursor loop");
    }
    assert_eq!(all.len(), expected, "{path}");
    let unique: BTreeSet<_> = all.iter().map(Value::to_string).collect();
    assert_eq!(unique.len(), expected, "duplicate page rows");
    Ok(all)
}

#[cfg(target_family = "wasm")]
#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    #[link_name = "clock_time_get"]
    fn read_cpu_clock(id: u32, precision: u64, timestamp: *mut u64) -> u16;
}
fn cpu_ns() -> u64 {
    #[cfg(target_family = "wasm")]
    {
        let mut timestamp = 0;
        assert_eq!(unsafe { read_cpu_clock(3, 1, &mut timestamp) }, 0);
        timestamp
    }
    #[cfg(not(target_family = "wasm"))]
    panic!("native query CPU measurements require psitest WASI clock 3")
}
fn query_samples(chain: &Chain, token: Option<&str>, path: &str, label: &str) -> Result<(), Error> {
    get(chain, token, path)?; // warm service compilation before timing
    for repeat in 0..5 {
        let before = cpu_ns();
        let response = match token {
            Some(token) => chain.get_auth(crate::SERVICE, path, token)?,
            None => chain.get(crate::SERVICE, path)?,
        };
        let elapsed = cpu_ns() - before;
        assert_eq!(response.status, 200);
        println!(
            "EXCHANGE_PAGE_METRIC {}",
            json!({"scenario":label,"repeat":repeat,
            "thread_cpu_ns":elapsed.to_string(),"response_bytes":response.body.len(),
            "note":"Per native HTTP query, includes authentication and response encoding; fixture creation excluded"})
        );
    }
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn pagination_native_exceeds_every_market_order_and_position_snapshot_limit(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let lp = account!("lp");
    let alice = account!("alice");
    let heavy = Wrapper::push_from(&chain, lp)
        .create(f.base, f.quote, 10_000, 100_000_000, 1, 1)
        .get()?;
    batch(
        &chain,
        (0..1_105)
            .map(|_| Wrapper::pack_from(lp).create(f.base, f.quote, 1_000, 100_000, 10, 1))
            .collect(),
    )?;
    let markets: Vec<_> = chain
        .open::<_, MarketTable>()
        .get_index_pk()
        .iter()
        .collect();
    assert_eq!(markets.len(), 1_107);
    let small: Vec<_> = markets
        .iter()
        .filter(|m| m.id != f.market && m.id != heavy)
        .map(|m| m.id)
        .collect();
    batch(
        &chain,
        (1_000..=2_000)
            .flat_map(|price| {
                [
                    Wrapper::pack_from(alice).limit(heavy, true, price, price),
                    Wrapper::pack_from(alice).limit(heavy, false, price + 19_000, 1),
                ]
            })
            .collect(),
    )?;
    batch(
        &chain,
        small
            .iter()
            .flat_map(|&market| {
                [
                    Wrapper::pack_from(alice).lend(market, false, 1_000),
                    Wrapper::pack_from(alice).borrow(market, true, 800, 1),
                    Wrapper::pack_from(alice).stop(market, true, 700, 10),
                ]
            })
            .collect(),
    )?;
    let last = *small.last().unwrap();
    Wrapper::push_from(&chain, account!("bob"))
        .limit(last, true, 500, 500)
        .get()?;
    Wrapper::push_from(&chain, alice)
        .limit(last, false, 2_000, 10)
        .get()?;
    Wrapper::push_from(&chain, account!("trader"))
        .trade(last, false, 50_000, 0, 64)
        .get()?;
    let token = chain.login(alice, crate::SERVICE)?;
    let lp_token = chain.login(lp, crate::SERVICE)?;
    let discovered = pages(&chain, None, "/markets?", "markets", 1_107)?;
    assert!(discovered.iter().any(|m| m["id"] == last));
    assert_eq!(
        get(&chain, None, &format!("/market?market={last}"))?["market"]["id"],
        last
    );
    for bid in [false, true] {
        pages(
            &chain,
            None,
            &format!("/book?market={heavy}&bid={bid}"),
            "levels",
            1_001,
        )?;
    }
    assert_eq!(
        get(&chain, None, &format!("/book?market={last}&bid=true"))?["levels"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    pages(
        &chain,
        Some(&token),
        "/positions?kind=orders",
        "rows",
        2_003,
    )?;
    pages(&chain, Some(&token), "/positions?kind=loans", "rows", 1_105)?;
    pages(
        &chain,
        Some(&token),
        "/positions?kind=lenders",
        "rows",
        1_105,
    )?;
    pages(
        &chain,
        Some(&lp_token),
        "/positions?kind=liquidity",
        "rows",
        1_107,
    )?;
    let late = get(&chain, Some(&token), &format!("/snapshot?market={last}"))?;
    assert!(late["markets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == last));
    assert_eq!(late["loan_positions"].as_array().unwrap().len(), 1);
    assert_eq!(late["lenders"].as_array().unwrap().len(), 1);
    assert_eq!(late["positions"].as_array().unwrap().len(), 1);
    assert_eq!(late["positions"][0]["owner"], "alice", "Bob's order leaked");
    for id in [f.base, f.quote] {
        assert!(late["balances"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["token"] == id));
    }
    // Existing descending stop pages also remain complete beyond 1,000 rows.
    let mut before = String::new();
    let mut stops = BTreeSet::new();
    loop {
        let p = get(&chain, Some(&token), &format!("/stops?limit=73{before}"))?;
        for row in p["stop_positions"].as_array().unwrap() {
            assert_eq!(row["owner"], "alice");
            assert!(stops.insert(row["generation"].to_string()));
        }
        if p["next_before"].is_null() {
            break;
        }
        before = format!("&before={}", p["next_before"]);
    }
    assert_eq!(stops.len(), 1_105);
    let early = get(&chain, None, "/markets?limit=73")?;
    query_samples(&chain, None, "/markets?limit=73", "market_page_first")?;
    query_samples(
        &chain,
        None,
        &format!("/markets?limit=73&after={}", discovered[1_021]["id"]),
        "market_page_late",
    )?;
    assert!(cursor(&early).is_some());
    let mut p = get(&chain, Some(&token), "/positions?kind=orders&limit=73")?;
    for _ in 0..25 {
        p = get(
            &chain,
            Some(&token),
            &format!(
                "/positions?kind=orders&limit=73&after={}",
                cursor(&p).unwrap()
            ),
        )?;
    }
    query_samples(
        &chain,
        Some(&token),
        "/positions?kind=orders&limit=73",
        "order_page_first",
    )?;
    query_samples(
        &chain,
        Some(&token),
        &format!(
            "/positions?kind=orders&limit=73&after={}",
            cursor(&p).unwrap()
        ),
        "order_page_late",
    )?;
    // A payout beyond 2,000 unrelated positions must be discoverable without
    // treating an empty first receipt page as proof of insufficient funds.
    let funding_path = format!("/funding?tokens={}&limit=73", f.quote);
    let mut funding = get(&chain, Some(&token), &funding_path)?;
    assert_eq!(funding["claims"].as_array().unwrap().len(), 0);
    assert_eq!(funding["complete"], false);
    let mut funding_steps = 1;
    while funding["claims"].as_array().unwrap().is_empty() {
        let next = funding["next_cursor"]
            .as_str()
            .expect("late claim scan must continue");
        funding = get(
            &chain,
            Some(&token),
            &format!("{funding_path}&after={next}"),
        )?;
        assert!(funding["scanned"].as_u64().unwrap() <= 73);
        funding_steps += 1;
        assert!(funding_steps < 100, "nonadvancing funding scan");
    }
    assert!(funding_steps > 20);
    assert!(funding["claims"]
        .as_array()
        .unwrap()
        .iter()
        .any(|claim| claim["action"]["args"]["market"] == last));
    Wrapper::push_from(&chain, alice)
        .settle(last, false, 2_000)
        .get()?;
    // Financial operations remain reachable at the final discovery page.
    Wrapper::push_from(&chain, alice)
        .repay(last, true, 800, 1)
        .get()?;
    Wrapper::push_from(&chain, account!("bob"))
        .cancel(last, true, 500)
        .get()?;
    audit(&chain);
    println!(
        "EXCHANGE_PAGE_FIXTURE {}",
        json!({"markets":1107,"book_levels_per_side":1001,
        "own_orders":2003,"own_borrowers":1105,"own_lenders":1105,
        "own_liquidity":1107,"own_stops":1105,"page_size":73})
    );
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn pagination_native_cursor_scope_deletion_and_private_routes(chain: Chain) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let alice = account!("alice");
    let bob = account!("bob");
    for price in [80, 81, 82] {
        Wrapper::push_from(&chain, alice)
            .limit(f.market, true, price, price * 100)
            .get()?;
        Wrapper::push_from(&chain, bob)
            .limit(f.market, true, price, price * 100)
            .get()?;
    }
    let token = chain.login(alice, crate::SERVICE)?;
    let bob_token = chain.login(bob, crate::SERVICE)?;
    let first = get(&chain, Some(&token), "/positions?kind=orders&limit=1")?;
    let after = cursor(&first).unwrap();
    assert_eq!(first["rows"][0]["price"], 80);
    // An exclusive key cursor remains valid if the row that issued it vanishes.
    Wrapper::push_from(&chain, alice)
        .cancel(f.market, true, 80)
        .get()?;
    let next = get(
        &chain,
        Some(&token),
        &format!("/positions?kind=orders&limit=1&after={after}"),
    )?;
    assert_eq!(next["rows"][0]["price"], 81);
    for (credential, path) in [
        (&bob_token, format!("/positions?kind=orders&after={after}")),
        (&token, format!("/positions?kind=loans&after={after}")),
        (
            &token,
            format!("/positions?kind=orders&market={}&after={after}", f.market),
        ),
    ] {
        assert_eq!(
            chain.get_auth(crate::SERVICE, &path, credential)?.status,
            400
        );
    }
    let book = get(
        &chain,
        None,
        &format!("/book?market={}&bid=true&limit=1", f.market),
    )?;
    let book_after = cursor(&book).unwrap();
    assert_eq!(
        chain
            .get(
                crate::SERVICE,
                &format!("/book?market={}&bid=false&after={book_after}", f.market)
            )?
            .status,
        400
    );
    let private_paths = [
        "/positions?kind=orders".to_string(),
        format!(
            "/position?kind=orders&market={}&side=true&price=81",
            f.market
        ),
        "/assets".into(),
        format!("/asset?token={}", f.base),
        format!(
            "/funding?tokens={},{}",
            f.base.min(f.quote),
            f.base.max(f.quote)
        ),
    ];
    let alias = account!("pagealias");
    chain.new_account(alias)?;
    psibase::services::http_server::Wrapper::push_from(&chain, alias)
        .registerServer(exchange_pkg::r_exchange::SERVICE)
        .get()?;
    for path in &private_paths {
        assert_eq!(chain.get(crate::SERVICE, path)?.status, 403, "{path}");
        assert_eq!(
            chain.get_auth(alias, path, &token)?.status,
            403,
            "alias {path}"
        );
        assert_eq!(
            chain
                .get_auth(
                    crate::SERVICE,
                    &format!(
                        "{path}{}owner=bob",
                        if path.contains('?') { "&" } else { "?" }
                    ),
                    &token
                )?
                .status,
            403
        );
        get(&chain, Some(&token), path)?;
    }
    for path in [
        "/markets?limit=0",
        "/markets?limit=201",
        "/markets?after=-1",
        "/positions?kind=orders&limit=0",
        "/positions?kind=orders&limit=201",
        "/positions?kind=orders&after=",
        "/positions?kind=orders&after=p1.ff",
        "/positions?kind=all",
        "/assets?limit=201",
        "/assets?after=invalid",
        "/funding?tokens=1,1",
        "/funding?tokens=2,1",
        "/funding?tokens=1&limit=201",
        "/book?market=1&bid=true&limit=201",
        "/market?market=18446744073709551616",
    ] {
        assert_eq!(
            chain.get_auth(crate::SERVICE, path, &token)?.status,
            400,
            "{path}"
        );
    }
    // Same shared price level never gives Alice Bob's balances or shares.
    let own = get(
        &chain,
        Some(&token),
        &format!(
            "/position?kind=orders&market={}&side=true&price=81",
            f.market
        ),
    )?;
    assert_eq!(own["rows"].as_array().unwrap().len(), 1);
    assert_eq!(own["rows"][0]["owner"], "alice");
    audit(&chain);
    Ok(())
}

#[psibase::test_case(packages("Exchange"))]
fn pagination_native_asset_union_skips_duplicate_pending_recipients(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let issuer = account!("issuer");
    let alice = account!("alice");
    let previous = chain
        .open::<_, tokens::tables::tables::TokenTable>()
        .get_index_pk()
        .iter()
        .map(|t| t.id)
        .max()
        .unwrap();
    batch(
        &chain,
        (0..1_005)
            .map(|_| Tokens::pack_from(issuer).create(4.try_into().unwrap(), 100_u64.into()))
            .collect(),
    )?;
    let created: Vec<_> = chain
        .open::<_, tokens::tables::tables::TokenTable>()
        .get_index_pk()
        .iter()
        .filter(|t| t.id > previous)
        .collect();
    assert_eq!(created.len(), 1_005);
    batch(
        &chain,
        created
            .iter()
            .flat_map(|t| {
                [
                    Nft::pack_from(issuer).debit(t.nft_id, "".into()),
                    Tokens::pack_from(issuer).mint(t.id, 10_u64.into(), "".into()),
                    Tokens::pack_from(issuer).credit(t.id, alice, 1_u64.into(), "".into()),
                ]
            })
            .collect(),
    )?;
    Tokens::push_from(&chain, issuer)
        .credit(f.base, alice, 1_005_u64.into(), "".into())
        .get()?;
    let recipients: Vec<AccountNumber> = (0..1_005)
        .map(|i| {
            format!(
                "pending{}{}{}",
                char::from(b'a' + (i / 676) as u8),
                char::from(b'a' + (i / 26 % 26) as u8),
                char::from(b'a' + (i % 26) as u8)
            )
            .parse()
            .unwrap()
        })
        .collect();
    batch(
        &chain,
        recipients
            .iter()
            .flat_map(|&owner| {
                [
                    psibase::services::accounts::Wrapper::pack().newAccount(
                        owner,
                        account!("auth-any"),
                        psibase::services::accounts::NewAccountMode::KeepExisting,
                    ),
                    Tokens::pack_from(alice).credit(f.base, owner, 1_u64.into(), "".into()),
                ]
            })
            .collect(),
    )?;
    let pending_count = chain
        .open::<_, tokens::tables::tables::UserPendingTable>()
        .get_index_pk()
        .iter()
        .filter(|row| row.user == alice)
        .count();
    assert!(pending_count > 1_000);
    let token = chain.login(alice, crate::SERVICE)?;
    let expected: BTreeSet<_> = created
        .iter()
        .map(|t| t.id)
        .chain([f.base, f.quote])
        .collect();
    let assets = pages(&chain, Some(&token), "/assets?", "balances", expected.len())?;
    let ids: BTreeSet<_> = assets
        .iter()
        .map(|b| b["token"].as_u64().unwrap() as u32)
        .collect();
    assert_eq!(ids, expected);
    let first = get(&chain, Some(&token), "/assets?limit=1")?;
    let next = get(
        &chain,
        Some(&token),
        &format!("/assets?limit=1&after={}", cursor(&first).unwrap()),
    )?;
    assert_eq!(
        next["balances"][0]["token"], f.quote,
        "same-token pending recipients starved next token"
    );
    let last = created.last().unwrap().id;
    let point = get(&chain, Some(&token), &format!("/asset?token={last}"))?;
    assert_eq!(point["balance"]["wallet"], 1);
    assert_eq!(point["token"]["id"], last);
    query_samples(
        &chain,
        Some(&token),
        "/assets?limit=73",
        "asset_page_duplicate_pending",
    )?;
    audit(&chain);
    println!(
        "EXCHANGE_PAGE_FIXTURE {}",
        json!({"assets":expected.len(),
        "pending_recipients_same_token":1005,"late_asset":last})
    );
    Ok(())
}
