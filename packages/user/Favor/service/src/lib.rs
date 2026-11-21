pub mod crypto;
pub mod routing;
pub mod tables;
use crypto::{Context, Envelope, Hop, INVALID};
use psibase::{AccountNumber, ServiceWrapper, Table};
pub use tables::tables::*;

pub fn pair_key(
    symbol: &str,
    a: AccountNumber,
    b: AccountNumber,
) -> (String, AccountNumber, AccountNumber) {
    if a.value < b.value {
        (symbol.into(), a, b)
    } else {
        (symbol.into(), b, a)
    }
}
pub fn capacity(line: &Line, from: AccountNumber) -> u64 {
    let value = if from == line.low {
        line.high_limit as i128 + line.balance as i128
    } else {
        line.low_limit as i128 - line.balance as i128
    };
    value.max(0) as u64
}
pub fn now() -> i64 {
    psibase::services::transact::Wrapper::call()
        .currentBlock()
        .time
        .seconds()
        .seconds
}
pub fn route_key() -> Result<RouteKey, &'static str> {
    RouteKeys::with_service(Wrapper::SERVICE)
        .get_index_pk()
        .get(&0)
        .ok_or(INVALID)
}
pub fn request_only(user: AccountNumber) -> bool {
    Preferences::with_service(Wrapper::SERVICE)
        .get_index_pk()
        .get(&user)
        .is_some_and(|p| p.request_only)
}
pub fn check_request(
    hash: Option<&str>,
    payee: AccountNumber,
    payer: AccountNumber,
    symbol: &str,
    amount: u64,
    time: i64,
) -> Result<Option<Request>, &'static str> {
    let Some(hash) = hash else {
        return if request_only(payee) {
            Err(INVALID)
        } else {
            Ok(None)
        };
    };
    let r = Requests::with_service(Wrapper::SERVICE)
        .get_index_pk()
        .get(&hash.to_string())
        .ok_or(INVALID)?;
    if r.owner != payee
        || r.symbol != symbol
        || r.consumed
        || r.revoked
        || r.expires_at < time
        || (r.amount != 0 && r.amount != amount)
        || r.payer.is_some_and(|p| p != payer)
    {
        return Err(INVALID);
    }
    Ok(Some(r))
}
/// Authenticated query entry point. All details remain local to the query;
/// only the sealed route and public payment summary are returned to the signer.
pub fn quote(
    payer: AccountNumber,
    payee: AccountNumber,
    symbol: &str,
    amount: u64,
    reference: &str,
    request_secret: Option<&str>,
    random: &[u8; 360],
) -> Result<(Context, String), &'static str> {
    routing::symbol(symbol).map_err(|_| INVALID)?;
    if !valid_reference(reference) {
        return Err(INVALID);
    }
    let time = now();
    let request = request_secret.map(crypto::hash_secret).transpose()?;
    let invoice = check_request(request.as_deref(), payee, payer, symbol, amount, time)?;
    let key = route_key()?;
    let mut lines = Vec::<Line>::new();
    let mut indexes = std::collections::BTreeMap::<u64, usize>::new();
    let route = routing::find_route_with(payer.value, payee.value, amount, |node| {
        let account = AccountNumber::new(node);
        let table = Lines::with_service(Wrapper::SERVICE);
        let low = table.get_index_by_low();
        let high = table.get_index_by_high();
        let min = (account, symbol.to_string(), AccountNumber::MIN);
        let max = (account, symbol.to_string(), AccountNumber::MAX);
        let mut incoming = vec![];
        for line in low
            .range(min.clone()..=max.clone())
            .chain(high.range(min..=max))
            .take(routing::MAX_EDGES + 1)
        {
            if incoming.len() >= routing::MAX_EDGES {
                return Err(INVALID);
            }
            let index = if let Some(&index) = indexes.get(&line.id) {
                index
            } else {
                if lines.len() >= routing::MAX_EDGES {
                    return Err(INVALID);
                }
                let index = lines.len();
                indexes.insert(line.id, index);
                lines.push(line.clone());
                index
            };
            let from_low = account == line.high;
            let from = if from_low { line.low } else { line.high };
            incoming.push((
                index * 2 + usize::from(!from_low),
                routing::Edge {
                    from: from.value,
                    to: node,
                    capacity: capacity(&line, from),
                    fee_ppm: if from_low {
                        line.low_fee
                    } else {
                        line.high_fee
                    },
                    forwarding: if from_low {
                        line.low_forward
                    } else {
                        line.high_forward
                    },
                },
            ));
        }
        Ok(incoming)
    })
    .map_err(|_| INVALID)?;
    let context = Context {
        version: 1,
        epoch: key.epoch,
        payer: payer.to_string(),
        payee: payee.to_string(),
        symbol: symbol.into(),
        amount,
        total: route.total,
        expires_at: invoice
            .as_ref()
            .map_or(time + 60, |r| r.expires_at.min(time + 60)),
        reference: reference.into(),
        request,
    };
    let hops: Vec<_> = route
        .transfers
        .iter()
        .enumerate()
        .map(|(position, &(index, value))| {
            let l = &lines[index / 2];
            (
                (if index % 2 == 0 { l.low } else { l.high }).to_string(),
                Hop {
                    line: l.id,
                    amount: value,
                    revision: l.revision,
                    end: position + 1 == route.transfers.len(),
                },
            )
        })
        .collect();
    let encoded = Envelope::seal(&key.secret, context.clone(), &hops, random)?;
    Ok((context, encoded))
}
pub fn valid_reference(reference: &str) -> bool {
    (8..=64).contains(&reference.len())
        && reference
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
#[derive(Debug)]
pub struct Transfer {
    pub line: Line,
    pub from: AccountNumber,
    pub to: AccountNumber,
    pub amount: u64,
}
/// Validates at most seven rows. Never loads the graph or invokes route search.
/// The same helper is used by execution and native security tests.
pub fn validate_route(
    envelope: &Envelope,
    secret: &[u8],
    mut load: impl FnMut(u64) -> Option<Line>,
) -> Result<Vec<Transfer>, &'static str> {
    envelope.authenticate(secret)?;
    let c = &envelope.context;
    let payer = AccountNumber::from_exact(&c.payer).map_err(|_| INVALID)?;
    let payee = AccountNumber::from_exact(&c.payee).map_err(|_| INVALID)?;
    if payer == payee || c.amount == 0 || c.total < c.amount || c.total > routing::MAX_AMOUNT {
        return Err(INVALID);
    }
    let mut current = payer;
    let mut expected = c.total;
    let mut seen = vec![payer];
    let mut result = Vec::new();
    for index in 0..crypto::SLOTS {
        let hop = envelope.open(secret, &current.to_string(), index)?;
        let line = load(hop.line).ok_or(INVALID)?;
        if line.symbol != c.symbol
            || line.revision != hop.revision
            || !(current == line.low || current == line.high)
            || hop.amount == 0
            || hop.amount > routing::MAX_AMOUNT
            || hop.amount > capacity(&line, current)
        {
            return Err(INVALID);
        }
        let low = current == line.low;
        let next = if low { line.high } else { line.low };
        if seen.contains(&next) {
            return Err(INVALID);
        }
        let fee = if index == 0 {
            0
        } else {
            if !(if low {
                line.low_forward
            } else {
                line.high_forward
            }) {
                return Err(INVALID);
            }
            let ppm = if low { line.low_fee } else { line.high_fee };
            if ppm > routing::PPM as u32 {
                return Err(INVALID);
            }
            ((hop.amount as u128 * ppm as u128 + routing::PPM as u128 - 1) / routing::PPM as u128)
                as u64
        };
        if hop.amount.checked_add(fee) != Some(expected) {
            return Err(INVALID);
        }
        result.push(Transfer {
            line,
            from: current,
            to: next,
            amount: hop.amount,
        });
        if hop.end {
            if next != payee || hop.amount != c.amount {
                return Err(INVALID);
            }
            return Ok(result);
        }
        if next == payee {
            return Err(INVALID);
        }
        current = next;
        expected = hop.amount;
        seen.push(next);
    }
    Err(INVALID)
}
#[psibase::service(name = "favor", tables = "tables::tables")]
pub mod service {
    use super::*;
    use psibase::*;
    fn peer(peer: AccountNumber) {
        assert_ne!(peer, get_sender(), "Choose someone other than yourself");
        assert!(
            services::accounts::Wrapper::call().exists(peer),
            "Account does not exist"
        );
    }
    fn quantity(value: &str) -> u64 {
        routing::units(value).unwrap_or_else(|e| abort_message(e))
    }
    fn check_symbol(symbol: &str) {
        routing::symbol(symbol).unwrap_or_else(|e| abort_message(e));
    }
    fn next_id(key: u8) -> u64 {
        let table = Counters::read_write();
        let id = table.get_index_pk().get(&key).map_or(1, |r| r.next);
        table
            .put(&Counter {
                key,
                next: id.checked_add(1).expect("IDs exhausted"),
            })
            .unwrap();
        id
    }
    fn check_nonce(nonce: &str) {
        assert!(valid_reference(nonce), "Invalid payment reference");
        assert!(
            Payments::read()
                .get_index_pk()
                .get(&(get_sender(), nonce.into()))
                .is_none(),
            "This payment reference has already been used"
        );
    }
    /// Network administrator provisions a random 256-bit key in protected
    /// objective state. Rotation invalidates all previews; no keys are in WASM.
    #[action]
    fn rotate_key(secret: Hex<Vec<u8>>) {
        assert_eq!(
            get_sender(),
            Wrapper::SERVICE,
            "Only the service owner can rotate routing keys"
        );
        assert_eq!(secret.0.len(), 32, "A 256-bit routing key is required");
        let table = RouteKeys::read_write();
        let epoch = table
            .get_index_pk()
            .get(&0)
            .map_or(1, |r| r.epoch.checked_add(1).expect("Key epochs exhausted"));
        table
            .put(&RouteKey {
                key: 0,
                epoch,
                secret: secret.0,
            })
            .unwrap();
    }
    #[action]
    fn set_line(
        peer: AccountNumber,
        symbol: String,
        limit: String,
        fee_ppm: u32,
        forwarding: bool,
    ) {
        self::peer(peer);
        check_symbol(&symbol);
        assert!(
            fee_ppm <= routing::PPM as u32,
            "Routing fee cannot exceed 100%"
        );
        let limit = quantity(&limit);
        let sender = get_sender();
        let key = pair_key(&symbol, sender, peer);
        let mut line = Lines::read()
            .get_index_by_pair()
            .get(&key)
            .unwrap_or_else(|| Line {
                id: next_id(1),
                symbol,
                low: key.1,
                high: key.2,
                low_limit: 0,
                high_limit: 0,
                balance: 0,
                low_fee: 0,
                high_fee: 0,
                low_forward: true,
                high_forward: true,
                revision: 0,
            });
        if sender == line.low {
            line.low_limit = limit;
            line.low_fee = fee_ppm;
            line.low_forward = forwarding;
        } else {
            line.high_limit = limit;
            line.high_fee = fee_ppm;
            line.high_forward = forwarding;
        }
        line.revision = line.revision.checked_add(1).expect("Revisions exhausted");
        Lines::read_write().put(&line).unwrap();
    }
    #[action]
    fn set_receiving(request_only: bool) {
        Preferences::read_write()
            .put(&Preference {
                user: get_sender(),
                request_only,
            })
            .unwrap();
    }
    #[action]
    fn create_request(
        hash: String,
        symbol: String,
        amount: String,
        expires_at: i64,
        payer: Option<AccountNumber>,
    ) {
        check_symbol(&symbol);
        let amount = quantity(&amount);
        assert!(
            crypto::unhex(&hash).is_ok_and(|b| b.len() == 32),
            "Invalid payment request"
        );
        assert!(
            expires_at > now() && expires_at <= now() + 30 * 86400,
            "Choose an expiry within 30 days"
        );
        if let Some(p) = payer {
            peer(p);
        }
        let table = Requests::read_write();
        assert!(
            table.get_index_pk().get(&hash).is_none(),
            "Payment request already exists"
        );
        table
            .put(&Request {
                hash,
                owner: get_sender(),
                symbol,
                amount,
                expires_at,
                payer,
                consumed: false,
                revoked: false,
            })
            .unwrap();
    }
    #[action]
    fn revoke_request(hash: String) {
        let table = Requests::read_write();
        let mut r = table
            .get_index_pk()
            .get(&hash)
            .expect("Payment request not found");
        assert_eq!(
            r.owner,
            get_sender(),
            "This payment request belongs to someone else"
        );
        r.revoked = true;
        table.put(&r).unwrap();
    }
    /// The complete encoded route is an action argument. Objective execution
    /// authenticates and checks only its rows; search is subjective query work.
    #[action]
    fn pay(
        payee: AccountNumber,
        symbol: String,
        amount: String,
        max_total: String,
        encoded_route: String,
        reference: String,
        memo: String,
    ) -> u64 {
        assert!(memo.len() <= 256, "Payment note is too long");
        check_nonce(&reference);
        let e = Envelope::parse(&encoded_route).unwrap_or_else(|e| abort_message(e));
        let c = &e.context;
        let time = now();
        let sender = get_sender();
        let key = route_key().unwrap_or_else(|e| abort_message(e));
        assert!(
            c.epoch == key.epoch
                && c.payer == sender.to_string()
                && c.payee == payee.to_string()
                && c.symbol == symbol
                && c.amount == quantity(&amount)
                && c.total <= quantity(&max_total)
                && c.reference == reference
                && c.expires_at >= time
                && c.expires_at <= time + 300,
            "{}",
            INVALID
        );
        let invoice = check_request(c.request.as_deref(), payee, sender, &symbol, c.amount, time)
            .unwrap_or_else(|e| abort_message(e));
        let mut transfers =
            validate_route(&e, &key.secret, |id| Lines::read().get_index_pk().get(&id))
                .unwrap_or_else(|e| abort_message(e));
        let id = next_id(0);
        for t in &mut transfers {
            let delta = t.amount as i64;
            t.line.balance = if t.from == t.line.low {
                t.line.balance.checked_sub(delta)
            } else {
                t.line.balance.checked_add(delta)
            }
            .expect("Balance overflow");
            Lines::read_write().put(&t.line).unwrap();
        }
        for pos in 0..=transfers.len() {
            let incoming = pos.checked_sub(1).map(|i| &transfers[i]);
            let outgoing = transfers.get(pos);
            let owner = outgoing.map_or_else(|| incoming.unwrap().to, |t| t.from);
            Receipts::read_write()
                .put(&Receipt {
                    owner,
                    id,
                    kind: if owner == sender {
                        "sent"
                    } else if owner == payee {
                        "received"
                    } else {
                        "routed"
                    }
                    .into(),
                    symbol: symbol.clone(),
                    incoming: if owner == payee {
                        Some(sender)
                    } else {
                        incoming.map(|t| t.from)
                    },
                    outgoing: if owner == sender {
                        Some(payee)
                    } else {
                        outgoing.map(|t| t.to)
                    },
                    received: incoming.map_or(0, |t| t.amount),
                    sent: outgoing.map_or(0, |t| t.amount),
                    memo: if owner == sender || owner == payee {
                        memo.clone()
                    } else {
                        String::new()
                    },
                    time,
                })
                .unwrap();
        }
        if let Some(mut r) = invoice {
            r.consumed = true;
            Requests::read_write().put(&r).unwrap();
        }
        Payments::read_write()
            .put(&Payment {
                payer: sender,
                nonce: reference,
                id,
            })
            .unwrap();
        id
    }
    /// A creditor acknowledges repayment outside the app. No routing or fee.
    #[action]
    fn settle(peer: AccountNumber, symbol: String, amount: String, nonce: String) -> u64 {
        self::peer(peer);
        check_symbol(&symbol);
        check_nonce(&nonce);
        let sender = get_sender();
        let mut line = Lines::read()
            .get_index_by_pair()
            .get(&pair_key(&symbol, sender, peer))
            .expect("No relationship with this person");
        let amount = quantity(&amount);
        let owed = if sender == line.low {
            line.balance as i128
        } else {
            -(line.balance as i128)
        };
        assert!(
            amount > 0 && amount as i128 <= owed,
            "Repayment cannot exceed what this person owes you"
        );
        if sender == line.low {
            line.balance -= amount as i64;
        } else {
            line.balance += amount as i64;
        }
        Lines::read_write().put(&line).unwrap();
        let id = next_id(0);
        let time = now();
        for (owner, other, kind) in [
            (sender, peer, "repayment-recorded"),
            (peer, sender, "repaid"),
        ] {
            Receipts::read_write()
                .put(&Receipt {
                    owner,
                    id,
                    kind: kind.into(),
                    symbol: symbol.clone(),
                    incoming: Some(other),
                    outgoing: None,
                    received: amount,
                    sent: 0,
                    memo: String::new(),
                    time,
                })
                .unwrap();
        }
        Payments::read_write()
            .put(&Payment {
                payer: sender,
                nonce,
                id,
            })
            .unwrap();
        id
    }
}
#[cfg(test)]
mod tests;

// These tests execute the deployed WASM, not the Rust action implementations.
// test/contract.sh builds the artifacts before compiling this test module.
#[cfg(all(test, target_family = "wasm"))]
mod contract_tests;
