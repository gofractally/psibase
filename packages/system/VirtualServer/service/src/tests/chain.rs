use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use p256::pkcs8::DecodePrivateKey;
use psibase::{
    fracpack::Pack,
    services::{
        auth_sig::SubjectPublicKeyInfo,
        credentials,
        invite::{self, InvPayload},
        nft::Wrapper as Nft,
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
    get_billing_config, get_db_prealloc, get_disk_state, get_enable_billing_cost, get_invite_cost,
    get_network_vars, get_server_specs, get_total_consumed_disk, get_user_resources,
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
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
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
    .pos_from_resources(initial_disk_state.remaining_capacity)
    .cost_of(cap_consumed);
    let new_shortfall = new_disk_state.relay_shortfall.quantity.value;
    assert_eq!(new_shortfall, initial_shortfall + cost, "invalid increase");

    // Increase obj storage allocation
    let mut vars = get_network_vars(&chain);
    vars.obj_storage_bytes *= 2;
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
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
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
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

    Ok(())
}

// Increasing/decreasing server storage, and checking allocation/deallocation semantics
#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn server_storage(chain: psibase::Chain) -> Result<(), psibase::Error> {
    chain.finish_block();

    let alloc_before = get_network_vars(&chain).obj_storage_bytes;

    let mut specs = get_server_specs(&chain);
    specs.storage_bytes *= 2;
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
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
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
        .set_specs(specs.clone())
        .get()?;

    // Grow it again, allocate some, and then reducing should fail
    specs.storage_bytes *= 2;
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
        .set_specs(specs.clone())
        .get()?;
    let mut vars = get_network_vars(&chain);
    vars.obj_storage_bytes *= 3;
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
        .set_network_variables(vars.clone())
        .get()?;
    specs.storage_bytes /= 2;
    assert_error(
        Wrapper::propose(&chain, PRODUCER_ACCOUNT).set_specs(specs.clone()),
        "Storage space cannot be decreased below what has already been allocated to the network",
    );

    // Can't allocate above what is available according to the server specs
    vars.obj_storage_bytes *= 2;
    assert_error(
        Wrapper::propose(&chain, PRODUCER_ACCOUNT).set_network_variables(vars),
        "Total storage allocation must not exceed available server storage",
    );

    Ok(())
}

#[psibase::test_case(packages("VirtualServer", "StagedTx"))]
fn metering(chain: psibase::Chain) -> Result<(), psibase::Error> {
    let vserver = Wrapper::SERVICE;
    let tokens = tokens::Wrapper::SERVICE;
    let sys: tokens::TID = 1;
    let alice = AccountNumber::from("alice");

    initial_setup(&chain)?;

    let auth_prod = chain.login(PRODUCER_ACCOUNT, Wrapper::SERVICE)?;
    let auth_alice = chain.login(alice, Wrapper::SERVICE)?;

    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
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

    // Credit the settlement cost to VirtualServer before enabling billing
    let billing_cost = get_enable_billing_cost(&chain)?;
    if billing_cost > 0 {
        tokens::Wrapper::push_from(&chain, PRODUCER_ACCOUNT)
            .credit(sys, vserver, billing_cost.into(), "".into())
            .get()?;
    }

    // Verify enable billing
    Wrapper::propose(&chain, PRODUCER_ACCOUNT)
        .enable_billing(true, Some(PRODUCER_ACCOUNT))
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

    Ok(())
}

// Bytes consumed since init
fn disk_consumed(chain: &psibase::Chain) -> u64 {
    let disk = get_disk_state(chain);
    disk.max_capacity - disk.remaining_capacity
}

fn check_disk_invariant(label: &str, chain: &psibase::Chain) -> bool {
    let native = chain.database_usage(DbId::Native);
    let service = chain.database_usage(DbId::Service);
    let scanned = native + service;
    let prealloc = get_db_prealloc(chain);
    let consumed = disk_consumed(chain);
    let accounted = prealloc + consumed;
    let delta = scanned as i128 - accounted as i128;
    println!(
        "[{label}] scanned={} (native={}, service={}) = prealloc={} + consumed={} ({}), delta={}",
        fmt_num(scanned),
        fmt_num(native),
        fmt_num(service),
        fmt_num(prealloc),
        fmt_num(consumed),
        fmt_num(accounted),
        delta,
    );
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

    Ok(())
}
