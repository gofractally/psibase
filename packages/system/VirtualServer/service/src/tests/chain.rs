use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use p256::pkcs8::DecodePrivateKey;
use psibase::{
    account,
    fracpack::Pack,
    services::{
        auth_sig::SubjectPublicKeyInfo,
        credentials,
        invite::{self, InvPayload},
        nft::Wrapper as Nft,
        sites::Wrapper as Sites,
        staged_tx::Wrapper as StagedTx,
        tokens::{self, Decimal, Precision, Quantity, Wrapper as Tokens},
        verify_sig,
    },
    *,
};
use rand::Rng;
use std::str::FromStr;

use crate::tables::capacity_limit_pricing::Curve;
use crate::Wrapper;

use super::utils::{fmt_mb, fmt_num, fmt_sys};

use super::helpers::{assert_error, check_balance, enable_billing as setup_enable_billing};
use super::query::{
    get_billing_config, get_db_prealloc, get_disk_state, get_invite_cost, get_network_vars,
    get_server_specs, get_site_paths, get_sub_balance, get_total_consumed_disk, get_user_resources,
    DiskPricingState,
};

fn consumption_details(
    label: &str,
    chain: &psibase::Chain,
    account: AccountNumber,
    auth_token: &str,
) -> DiskPricingState {
    let consumed = get_total_consumed_disk(chain, account, auth_token);
    let disk = get_disk_state(chain);
    let (left, shortfall, excess) = (
        disk.remaining_capacity,
        disk.relay_shortfall.quantity.value,
        disk.relay_excess.quantity.value,
    );
    println!("--- {} ---", label);
    println!("  consumed:      {} bytes", fmt_num(consumed as u64));
    println!("  remaining_cap: {} MB", fmt_mb(left));
    println!("  shortfall:     {}", fmt_sys(shortfall));
    println!("  excess:        {}", fmt_sys(excess));
    disk
}

// Creates a system token and distributes it to alice and bob
fn initial_setup(chain: &psibase::Chain) -> Result<(), psibase::Error> {
    let tokens_service = tokens::Wrapper::SERVICE;
    let symbol = account!("symbol");
    let alice = account!("alice");
    let bob = account!("bob");

    chain.new_account(alice).unwrap();
    chain.new_account(bob).unwrap();

    let supply: u64 = 21_000_000_000_0000u64.into();
    let sys = tokens::Wrapper::push_from(chain, symbol)
        .create(Precision::new(4).unwrap(), Quantity::from(supply))
        .get()?;

    let nid = Tokens::push(&chain).getToken(sys).get()?.nft_id;
    Nft::push_from(chain, symbol).debit(nid, "".into()).get()?;

    Tokens::push_from(chain, tokens_service)
        .setSysToken(sys)
        .get()?;

    tokens::Wrapper::push_from(chain, symbol)
        .mint(sys, Quantity::from(supply), "".into())
        .get()?;

    tokens::Wrapper::push_from(chain, symbol)
        .credit(sys, alice, 100_000_0000u64.into(), "".into())
        .get()?;

    tokens::Wrapper::push_from(chain, symbol)
        .credit(sys, bob, 100_000_0000u64.into(), "".into())
        .get()?;

    chain.finish_block();

    Ok(())
}

// shortfall tracking after consumption, capacity increases, and supply reductions
#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn relay_balance_basics(chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.finish_block();

    let token_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;

    let initial_disk_state = get_disk_state(&chain);
    let initial_shortfall = initial_disk_state.relay_shortfall.quantity.value;
    assert!(initial_shortfall > 0, "Expected nonzero initial shortfall");

    // Increase server storage to accommodate increased obj allocation
    let mut specs = get_server_specs(&chain);
    specs.storage_bytes *= 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_specs(specs)
        .get()?;
    let after_propose = consumption_details("After propose", &chain, PRODUCER_ACCOUNT, &token_prod);

    // Finish the block, which triggers startBlock on the next block
    chain.finish_block();

    // startBlock frees some space when tx expires and it's removed from IncludedTrxTable,
    // so if anything we should expect a small increase in capacity after startBlock and
    // a corresponding shortfall decrease.
    let new_disk_state =
        consumption_details("After finish_block", &chain, PRODUCER_ACCOUNT, &token_prod);
    assert!(
        after_propose.remaining_capacity <= new_disk_state.remaining_capacity,
        "Unexpected consumption"
    );
    assert!(
        after_propose.relay_shortfall.quantity.value
            >= new_disk_state.relay_shortfall.quantity.value,
        "Unexpected consumption"
    );

    // Verify shortfall increased by exactly the cost of the consumed bytes
    // Consumption comes from: IncludedTrxTable
    let cap_consumed = initial_disk_state.remaining_capacity - new_disk_state.remaining_capacity;
    let cost = Curve::new(
        initial_disk_state.max_reserve.quantity.value,
        initial_disk_state.max_capacity,
        initial_disk_state.curve_d,
    )
    .pos_from_remaining_capacity(initial_disk_state.remaining_capacity)
    .cost_of(cap_consumed);
    let new_shortfall = new_disk_state.relay_shortfall.quantity.value;
    assert_eq!(new_shortfall, initial_shortfall + cost, "invalid increase");

    // Increase obj storage allocation
    let mut vars = get_network_vars(&chain);
    vars.obj_storage_bytes *= 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_network_variables(vars)
        .get()?;

    let after_alloc = consumption_details(
        "After allocating more obj storage",
        &chain,
        PRODUCER_ACCOUNT,
        &token_prod,
    );

    let shortfall_after_alloc = after_alloc.relay_shortfall.quantity.value;
    assert!(
        shortfall_after_alloc < new_shortfall,
        "Shortfall should decrease after disk increase ({} >= {})",
        fmt_num(shortfall_after_alloc),
        fmt_num(new_shortfall),
    );

    // Reduce system token supply → shortfall should decrease further
    let decrease = initial_disk_state.max_reserve.quantity.value / 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .reduce_disk_budget(Quantity::from(decrease))
        .get()?;

    let after_supply_decrease = consumption_details(
        "After reducing system token supply",
        &chain,
        PRODUCER_ACCOUNT,
        &token_prod,
    );
    let shortfall_after_supply_decrease = after_supply_decrease.relay_shortfall.quantity.value;
    assert!(
        shortfall_after_supply_decrease < shortfall_after_alloc,
        "Shortfall should decrease after supply reduction ({} >= {})",
        fmt_num(shortfall_after_supply_decrease),
        fmt_num(shortfall_after_alloc),
    );

    chain.finish_block();
    assert!(
        check_disk_invariant("end of relay_balance_basics", &chain),
        "disk accounting invariant violated"
    );

    Ok(())
}

// Increasing/decreasing server storage, and checking allocation/deallocation semantics
#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn server_storage(chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.finish_block();

    let alloc_before = get_network_vars(&chain).obj_storage_bytes;

    let mut specs = get_server_specs(&chain);
    specs.storage_bytes *= 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_specs(specs.clone())
        .get()?;

    let alloc_after = get_network_vars(&chain).obj_storage_bytes;
    // Increasing server storage should not automatically increase allocated obj storage bytes
    assert_eq!(
        alloc_before, alloc_after,
        "Allocated bytes grew unexpectedly"
    );

    // Should be able to drop server storage since nothing extra was allocated
    specs.storage_bytes /= 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_specs(specs.clone())
        .get()?;

    // Grow it again, allocate some, and then reducing should fail
    specs.storage_bytes *= 2;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_specs(specs.clone())
        .get()?;
    let mut vars = get_network_vars(&chain);
    vars.obj_storage_bytes *= 3;
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .set_network_variables(vars.clone())
        .get()?;
    specs.storage_bytes /= 2;
    assert_error(
        chain
            .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
            .set_specs(specs.clone()),
        "Storage space cannot be decreased below what has already been allocated to the network",
    );

    // Can't allocate above what is available according to the server specs
    vars.obj_storage_bytes *= 2;
    assert_error(
        chain
            .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
            .set_network_variables(vars),
        "Total storage allocation must not exceed available server storage",
    );

    chain.finish_block();
    assert!(
        check_disk_invariant("end of server_storage", &chain),
        "disk accounting invariant violated"
    );

    Ok(())
}

#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn metering(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let vserver = Wrapper::SERVICE;
    let tokens = tokens::Wrapper::SERVICE;
    let sys: tokens::TID = 1;
    let alice = account!("alice");

    initial_setup(&chain)?;

    let auth_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;
    let auth_alice = chain.login(alice, Wrapper::SERVICE)?;

    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .init_billing(tokens)
        .get()?;

    let config = get_billing_config(&chain)?;
    assert!(config.feeReceiver == tokens.to_string());

    let min_resource_buffer = get_user_resources(&chain, PRODUCER_ACCOUNT, &auth_prod)?
        .bufferCapacity
        .quantity
        .value;

    check_balance(&chain, sys, PRODUCER_ACCOUNT, 0);

    tokens::Wrapper::push_from(&chain, alice)
        .credit(sys, PRODUCER_ACCOUNT, min_resource_buffer.into(), "".into())
        .get()?;

    // Verify filling resource buffer
    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, vserver, (min_resource_buffer / 2).into(), "".into())
        .get()?;
    assert_error(
        Wrapper::push_from(&chain, PRODUCER_ACCOUNT).buy_res(min_resource_buffer.into()),
        "Insufficient shared balance",
    );
    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, vserver, (min_resource_buffer / 2).into(), "".into())
        .get()?;
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .buy_res(min_resource_buffer.into())
        .get()?;
    assert_eq!(
        get_user_resources(&chain, PRODUCER_ACCOUNT, &auth_prod)?
            .balance
            .quantity
            .value,
        min_resource_buffer
    );

    // Send some more tokens to the producer account
    tokens::Wrapper::push_from(&chain, alice)
        .credit(sys, PRODUCER_ACCOUNT, 50_000_0000.into(), "".into())
        .get()?;

    // Verify enable billing
    chain
        .propose::<Wrapper>(PRODUCER_ACCOUNT, Wrapper::SERVICE)
        .enable_billing()
        .get()?;

    // Verify alice out of resources
    // This shows that alice cannot even buy herself resources
    assert_error(
        tokens::Wrapper::push_from(&chain, alice).credit(sys, vserver, 10_0000.into(), "".into()),
        "insufficient resource balance",
    );

    // Producer can buy her some
    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, vserver, min_resource_buffer.into(), "".into())
        .get()?;
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .buy_res_for(min_resource_buffer.into(), alice, Some("".into()))
        .get()?;
    assert_eq!(
        get_user_resources(&chain, alice, &auth_alice)?
            .balance
            .quantity
            .value,
        min_resource_buffer
    );

    // Now alice can transact
    let credit_result =
        tokens::Wrapper::push_from(&chain, alice).credit(sys, vserver, 23_0000.into(), "".into());
    println!("{}", chain.trace_disk_usage(&credit_result.trace, true));
    credit_result.get()?;

    chain.finish_block();

    let balance = get_user_resources(&chain, alice, &auth_alice)?
        .balance
        .quantity
        .value;
    assert!(balance < min_resource_buffer.into());

    println!("alice resource balance: {}", fmt_sys(balance));

    chain.finish_block();
    assert!(
        check_disk_invariant("end of metering", &chain),
        "disk accounting invariant violated"
    );

    Ok(())
}

#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn system_writes_accumulate_shortfall(chain: psibase::Chain) -> Result<(), psibase::Error> {
    initial_setup(&chain)?;
    setup_enable_billing(&chain)?;

    let disk_before = get_disk_state(&chain);
    let net_before = disk_before.relay_shortfall.quantity.value as i128
        - disk_before.relay_excess.quantity.value as i128;

    // finish_block triggers system writes (startBlock) with empty user.
    // Even while billing is enabled, these should accumulate to the virtual balance
    // rather than billing a real account.
    chain.finish_block();

    let disk_after = get_disk_state(&chain);
    let net_after = disk_after.relay_shortfall.quantity.value as i128
        - disk_after.relay_excess.quantity.value as i128;

    assert!(
        net_after < net_before,
        "Expected the relay net to indicate data was freed by system writes \
         (net before={}, after={})",
        net_before,
        net_after,
    );

    // Confirm the free was exactly 93 bytes (the IncludedTrxTable row size)
    let freed_bytes =
        disk_after.remaining_capacity as i128 - disk_before.remaining_capacity as i128;
    assert_eq!(
        freed_bytes, 93,
        "Expected exactly 93 bytes freed by startBlock system writes, got {}",
        freed_bytes,
    );

    chain.finish_block();
    assert!(
        check_disk_invariant("end of system_writes_accumulate_shortfall", &chain),
        "disk accounting invariant violated"
    );

    Ok(())
}

// Bytes consumed since init
fn disk_consumed(chain: &psibase::Chain) -> u64 {
    let disk = get_disk_state(chain);
    disk.max_capacity - disk.remaining_capacity
}

fn status_row_bytes(chain: &psibase::Chain) -> u64 {
    let key = status_key().to_key();
    chain
        .kv_get_bytes(DbId::Native, &key)
        .map(|value| key.len() as u64 + value.len() as u64)
        .unwrap_or(0)
}

fn check_disk_invariant(label: &str, chain: &psibase::Chain) -> bool {
    let native = chain.database_usage(DbId::Native);
    let service = chain.database_usage(DbId::Service);
    let status = status_row_bytes(chain);

    let scanned_bytes = native + service - status;

    let svc_prealloc = get_db_prealloc(chain);
    let svc_consumed = disk_consumed(chain);
    let svc_deficit = get_disk_state(chain).prealloc_deficit;
    let svc_accounting = svc_prealloc - svc_deficit + svc_consumed;

    let delta = scanned_bytes as i128 - svc_accounting as i128;
    if delta != 0 {
        println!(
            "[{label}] total={} (native={} + service={} - status={}) == prealloc={} - deficit={} + consumed={} ({}), delta={}",
            fmt_num(scanned_bytes),
            fmt_num(native),
            fmt_num(service),
            fmt_num(status),
            fmt_num(svc_prealloc),
            fmt_num(svc_deficit),
            fmt_num(svc_consumed),
            fmt_num(svc_accounting),
            delta,
        );
    }
    delta == 0
}

// Full-database accounting invariant test
//
// The core invariant: every byte written to the service + native db is
// either part of the prealloc baseline measured at init, or was written
// after that baseline was measured and therefore is tracked by the disk
// billing system.
#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn disk_accounting_invariant(chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.finish_block();
    let after_boot = check_disk_invariant("after boot", &chain);

    // Test a few actions that exercise edge-case paths in database writes, namely those
    // cases where a table is written to by both native and a service.

    // The status row is written by native internally during an isVerify service upload
    chain.deploy_service_with_flags(
        account!("vrfy-svc"),
        b"verify service placeholder code",
        psibase::CodeRow::IS_VERIFY,
    )?;
    chain.finish_block();
    let after_isverify = check_disk_invariant("after isVerify service", &chain);

    // The status row is also written by the producer service when the producer set is changed
    let producers = psibase::services::producers::SERVICE;
    chain.new_account(account!("prod2"))?;
    let auth_any = psibase::Claim::default();
    psibase::services::producers::Wrapper::push_from(&chain, producers)
        .setProducers(vec![
            psibase::Producer {
                name: PRODUCER_ACCOUNT,
                auth: auth_any.clone(),
            },
            psibase::Producer {
                name: account!("prod2"),
                auth: auth_any,
            },
        ])
        .get()?;
    chain.finish_block();
    let after_producers = check_disk_invariant("after producer change", &chain);

    // Verify invariant holds
    if !after_boot {
        println!("disk accounting invariant violated: after_boot={after_boot}",);
    }
    if !after_isverify {
        println!("disk accounting invariant violated: after_isverify={after_isverify}");
    }
    if !after_producers {
        println!("disk accounting invariant violated: after_producers={after_producers}");
    }
    assert!(
        after_boot && after_isverify && after_producers,
        "disk accounting invariant violated"
    );

    Ok(())
}

#[psibase::test_case(packages("VirtualServer", "StagedTx", "Invite", "Credentials"))]
fn invites(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let invite = invite::Wrapper::SERVICE;
    let sys: tokens::TID = 1;
    let token_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;

    initial_setup(&chain)?;
    setup_enable_billing(&chain)?;

    // Create the invite
    let (public_key, private_key) = psibase::generate_keypair()?;
    let invite_id: u32 = rand::rng().random();
    let min_cost = get_invite_cost(&chain, 1, &token_prod)?;
    let min_cost = Decimal::from_str(&min_cost).unwrap().quantity;
    assert!(min_cost.value > 0, "Cost of an invite should be > 0");

    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, invite, min_cost, "".into())
        .get()?;
    let inv_pubkey_der = pem::parse(public_key.trim())
        .map_err(|e| psibase::Error::new(e))?
        .into_contents();

    let fingerprint = psibase::sha256(&inv_pubkey_der);
    let payload = InvPayload {
        fingerprint: fingerprint.to_vec(),
        secret: "".to_string(),
    }
    .packed();

    invite::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .createInvite(invite_id, payload, 1, false, min_cost.into())
        .get()?;

    // Create an account using the invite
    let (new_public_key, _new_private_key) = psibase::generate_keypair()?;
    let new_pub_key_der = pem::parse(new_public_key.trim())
        .map_err(|e| psibase::Error::new(e))?
        .into_contents();

    let mut trx = Transaction {
        tapos: Default::default(),
        actions: vec![Action {
            sender: AccountNumber::from(credentials::CREDENTIAL_SENDER),
            service: invite,
            method: MethodNumber::new(method_raw!("createAccount")),
            rawData: (
                account!("alicealice"),
                SubjectPublicKeyInfo(new_pub_key_der),
            )
                .packed()
                .into(),
        }],
        claims: vec![Claim {
            service: verify_sig::Wrapper::SERVICE,
            rawData: inv_pubkey_der.clone().into(),
        }],
    };
    chain.fill_tapos(&mut trx, 2);
    let tx_packed = trx.packed();
    let signing_key =
        SigningKey::from_pkcs8_pem(&private_key).map_err(|e| psibase::Error::new(e))?;
    let signature: Signature = signing_key
        .sign_prehash(&psibase::sha256(&tx_packed).0)
        .map_err(|e| psibase::Error::new(e))?;
    let strx = SignedTransaction {
        transaction: tx_packed.into(),
        proofs: vec![signature.to_bytes().to_vec().into()],
        subjectiveData: None,
    };
    let trace = chain.push(&strx);
    if trace.error.is_some() {
        println!("{}", trace.error.unwrap());
        assert!(false, "Invite create acc fail");
    }

    chain.finish_block();
    assert!(
        check_disk_invariant("end of invites", &chain),
        "disk accounting invariant violated"
    );

    Ok(())
}

fn scanned_bytes(chain: &psibase::Chain) -> u64 {
    chain.database_usage(DbId::Native) + chain.database_usage(DbId::Service)
        - status_row_bytes(chain)
}
fn disk_consumed_now(chain: &psibase::Chain) -> u64 {
    let d = get_disk_state(chain);
    d.max_capacity - d.remaining_capacity
}

// Stores `total` bytes of site content at `/blob{tag}`
fn write(chain: &psibase::Chain, tag: u8, total: usize) -> Result<(), psibase::Error> {
    Sites::push_from(chain, PRODUCER_ACCOUNT)
        .storeSys(
            format!("/blob{tag}"),
            "application/octet-stream".to_string(),
            None,
            Hex(vec![tag; total]),
        )
        .get()?;
    chain.finish_block();
    Ok(())
}

fn free(chain: &psibase::Chain, tag: u8) -> Result<(), psibase::Error> {
    Sites::push_from(chain, PRODUCER_ACCOUNT)
        .remove(format!("/blob{tag}"))
        .get()?;
    chain.finish_block();
    Ok(())
}

// Frees all site content uploaded at boot, freeing far more than has been
// consumed since init and so dipping into the prealloc baseline. Returns the
// resulting prealloc deficit.
fn free_boot_content(chain: &psibase::Chain) -> Result<u64, psibase::Error> {
    let consumed_before = disk_consumed_now(chain);
    let scanned_before = scanned_bytes(chain);

    let accounts = [
        account!("common-api"),
        account!("supervisor"),
        account!("accounts"),
        account!("perms"),
        account!("clientdata"),
        account!("aes"),
        account!("kdf"),
        account!("base64"),
        account!("transact"),
        account!("sites"),
        account!("auth-sig"),
        account!("nft"),
        account!("tokens"),
        account!("symbol"),
        account!("invite"),
        account!("producers"),
    ];
    let actions: Vec<Action> = accounts
        .into_iter()
        .flat_map(|acct| {
            get_site_paths(chain, acct)
                .into_iter()
                .map(move |path| Sites::pack_from(acct).remove(path))
        })
        .collect();
    StagedTx::push_from(chain, PRODUCER_ACCOUNT)
        .propose(actions, true)
        .get()?;
    chain.finish_block();

    let physically_freed = scanned_before as i128 - scanned_bytes(chain) as i128;
    assert!(
        physically_freed > consumed_before as i128,
        "expected to free more than consumed: freed={physically_freed} consumed={consumed_before}",
    );

    let dipped = get_disk_state(chain);
    assert!(
        dipped.prealloc_deficit > 0,
        "expected freeing past consumed to record a deficit"
    );
    assert!(
        check_disk_invariant("after freeing prealloc bytes", chain),
        "invariant violated after freeing prealloc bytes"
    );

    println!(
        "freed {} MB > consumed {} MB; remaining {} / max {} MB; deficit {} MB",
        fmt_mb(physically_freed as u64),
        fmt_mb(consumed_before),
        fmt_mb(dipped.remaining_capacity),
        fmt_mb(dipped.max_capacity),
        fmt_mb(dipped.prealloc_deficit),
    );
    Ok(dipped.prealloc_deficit)
}

// Exercises the prealloc-deficit accounting
#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn free_into_prealloc(chain: psibase::Chain) -> Result<(), psibase::Error> {
    initial_setup(&chain)?;
    setup_enable_billing(&chain)?;
    chain.finish_block();

    let sys: tokens::TID = 1;
    let vserver = Wrapper::SERVICE;
    let vserver_token = chain.login(vserver, tokens::Wrapper::SERVICE)?;

    // Reserve tokens backing the disk pool live in this relay sub-account; refunds
    // are paid out of it and consumption charges flow into it.
    let relay_sub = format!("{vserver}.disk:relay");
    let relay_balance = |chain: &psibase::Chain| {
        get_sub_balance(chain, vserver, &relay_sub, sys, &vserver_token).unwrap()
    };

    let deficit = free_boot_content(&chain)?;

    {
        // a write within the deficit is free: no reserve tokens move
        let consumed_pre_write = disk_consumed_now(&chain);
        let relay_pre_write = relay_balance(&chain);

        write(&chain, 1, (deficit / 4) as usize)?;

        let after_write = get_disk_state(&chain);
        let consumed_after_write = after_write.max_capacity - after_write.remaining_capacity;
        assert_eq!(
            consumed_after_write, consumed_pre_write,
            "a write within the deficit must not change consumed",
        );

        assert!(
            after_write.prealloc_deficit < deficit,
            "the write should shrink the deficit"
        );
        assert_eq!(
            relay_balance(&chain),
            relay_pre_write,
            "an in-deficit write must not move reserve tokens into the relay",
        );
        assert!(
            check_disk_invariant("after in-deficit write", &chain),
            "invariant violated after in-deficit write"
        );
    }

    {
        // freeing into the prealloc pays no refund: no reserve tokens move
        let deficit_pre_free = get_disk_state(&chain).prealloc_deficit;
        let relay_pre_free = relay_balance(&chain);

        free(&chain, 1)?;

        let after_free = get_disk_state(&chain);
        let consumed_after_free = after_free.max_capacity - after_free.remaining_capacity;
        assert_eq!(
            consumed_after_free, 0,
            "a free within the deficit must not change consumed",
        );
        assert!(
            after_free.prealloc_deficit > deficit_pre_free,
            "the free should grow the deficit"
        );
        assert_eq!(
            relay_balance(&chain),
            relay_pre_free,
            "a free within the deficit must not refund reserve tokens",
        );
        assert!(
            check_disk_invariant("after in-deficit free", &chain),
            "invariant violated after in-deficit free"
        );
    }

    // Buy extra resources to comfortably cover the large writes below
    let extra_resources: u64 = 200_000_000;
    tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .credit(sys, vserver, extra_resources.into(), "".into())
        .get()?;
    Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
        .buy_res(extra_resources.into())
        .get()?;

    {
        // a write crossing the deficit boundary bills the excess into the relay
        let deficit_pre_cross = get_disk_state(&chain).prealloc_deficit;
        let consumed_pre_cross = disk_consumed_now(&chain);
        let scanned_pre_cross = scanned_bytes(&chain);
        let relay_pre_cross = relay_balance(&chain);

        write(&chain, 2, deficit_pre_cross as usize + 64 * 1024)?;

        let after_cross = get_disk_state(&chain);
        let consumed_after_cross = after_cross.max_capacity - after_cross.remaining_capacity;
        let scanned_after_cross = scanned_bytes(&chain);

        assert_eq!(
            after_cross.prealloc_deficit, 0,
            "crossing the boundary should drain the deficit"
        );
        assert_eq!(
            consumed_after_cross - consumed_pre_cross,
            scanned_after_cross - (scanned_pre_cross + deficit_pre_cross),
            "billed amount must equal bytes written above the prealloc",
        );
        assert!(
            relay_balance(&chain) > relay_pre_cross,
            "more reserve tokens should be in the relay",
        );
        assert!(
            check_disk_invariant("after writing past the prealloc deficit boundary", &chain),
            "invariant violated after writing past the prealloc deficit boundary"
        );
    }

    Ok(())
}
