//! Native HTTP privacy, bounded history, exact own claims and public trade data.
use super::*;

#[psibase::test_case(packages("Exchange"))]
fn stop_private_pages_and_point_reads_are_authenticated_owner_only(
    chain: Chain,
) -> Result<(), Error> {
    let f = setup(&chain, true)?;
    let a = Wrapper::push_from(&chain, account!("alice"));
    let b = Wrapper::push_from(&chain, account!("bob"));
    let first = a.stop(f.market, true, 90, 10_003).get()?;
    assert_eq!(b.stop(f.market, true, 90, 1_000).get()?, first);
    let second = a.stop(f.market, true, 89, 20_004).get()?;
    for path in ["/stops?owner=alice", "/stop?generation=1"] {
        assert_eq!(chain.get(crate::SERVICE, path)?.status, 403);
    }
    let token = chain.login(account!("alice"), crate::SERVICE)?;
    let get = |path: &str| -> Result<Value, Error> {
        let r = chain.get_auth(crate::SERVICE, path, &token)?;
        assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
        assert!(r
            .headers
            .iter()
            .any(|h| h.name.eq_ignore_ascii_case("Cache-Control") && h.value == "no-store"));
        Ok(serde_json::from_slice(&r.body)?)
    };
    let page = get("/stops?owner=alice&limit=1")?;
    assert_eq!(page["stop_positions"].as_array().unwrap().len(), 1);
    assert_eq!(page["stop_positions"][0]["generation"], second);
    assert_eq!(page["stop_positions"][0]["owner"], "alice");
    let older = get(&format!("/stops?before={second}&limit=1"))?;
    assert_eq!(older["stop_positions"][0]["generation"], first);
    assert!(older["next_before"].is_null());
    let own = get(&format!("/stop?generation={first}"))?;
    assert_eq!(own["stop_position"]["original_input"], 10_003);
    assert_eq!(own["stop_position"]["input_token"], f.base);
    assert_eq!(own["stop_position"]["output_token"], f.quote);
    assert_eq!(own["stop_position"]["input_auto_debit"], true);
    assert!(own["stop_position"].get("shares").is_none());
    assert!(get("/stop?generation=18446744073709551615")?["stop_position"].is_null());
    for path in [
        "/stops?owner=bob",
        "/api/stops?account=bob",
        "/stop?owner=bob&generation=1",
    ] {
        assert_eq!(chain.get_auth(crate::SERVICE, path, &token)?.status, 403);
    }
    for path in [
        "/stops?limit=0",
        "/stops?limit=201",
        "/stops?before=",
        "/stop?generation=-1",
        "/stop?generation=18446744073709551616",
    ] {
        assert_eq!(chain.get_auth(crate::SERVICE, path, &token)?.status, 400);
    }
    a.cancelstop(first).get()?;
    assert!(get(&format!("/stop?generation={first}"))?["stop_position"].is_null());
    // Alice's removal must not expose or erase Bob's same-generation position.
    assert_eq!(
        chain
            .open::<_, StopPositionTable>()
            .get_index_pk()
            .get(&(account!("bob"), first))
            .unwrap()
            .shares,
        1_000
    );
    Wrapper::push_from(&chain, account!("trader"))
        .trade(f.market, true, 200_000, 0, 256)
        .get()?;
    let closed = get(&format!("/stop?generation={second}"))?;
    assert_ne!(closed["stop_position"]["status"], "armed");
    assert_eq!(closed["stop_position"]["remaining_outgoing"], 0);
    assert!(
        closed["stop_position"]["claimable_output"]
            .as_u64()
            .unwrap()
            > 0
    );
    let tape: Value = serde_json::from_slice(
        &chain
            .get(
                crate::SERVICE,
                &format!("/trades?market={}&limit=10", f.market),
            )?
            .body
            ,
    )?;
    let executions = tape["trades"].as_array().unwrap();
    assert!(executions.iter().any(|r| r["kind"] == "stop"));
    assert!(executions
        .iter()
        .all(|r| r.get("owner").is_none() && r.get("batch").is_none()));
    audit(&chain);
    Ok(())
}
