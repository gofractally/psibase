#[psibase::service(name = "favor+1")]
#[allow(non_snake_case)]
mod service {
    use async_graphql::Error;
    use async_graphql::*;
    use favor::{capacity, now, routing, Line, Lines, Preferences, Receipts, Requests, RouteKeys};
    use psibase::*;

    struct Query {
        user: Option<AccountNumber>,
    }
    impl Query {
        fn user(&self) -> Result<AccountNumber> {
            self.user
                .ok_or_else(|| Error::new("Sign in to view your private credit network"))
        }
    }

    #[derive(SimpleObject)]
    struct Relationship {
        peer: AccountNumber,
        symbol: String,
        you_extend: String,
        they_extend: String,
        they_owe: String,
        you_owe: String,
        can_pay: String,
        can_receive: String,
        your_fee_ppm: u32,
        their_fee_ppm: u32,
        forwarding: bool,
        their_forwarding: bool,
        cursor: String,
    }
    impl Relationship {
        fn new(line: Line, user: AccountNumber) -> Self {
            let low = user == line.low;
            let peer = if low { line.high } else { line.low };
            let balance = if low { line.balance } else { -line.balance };
            Self {
                cursor: format!("{}:{:020}", line.symbol, peer.value),
                peer,
                symbol: line.symbol.clone(),
                you_extend: routing::decimal(if low { line.low_limit } else { line.high_limit }),
                they_extend: routing::decimal(if low { line.high_limit } else { line.low_limit }),
                they_owe: routing::decimal(balance.max(0) as u64),
                you_owe: routing::decimal((-balance).max(0) as u64),
                can_pay: routing::decimal(capacity(&line, user)),
                can_receive: routing::decimal(capacity(&line, peer)),
                your_fee_ppm: if low { line.low_fee } else { line.high_fee },
                their_fee_ppm: if low { line.high_fee } else { line.low_fee },
                forwarding: if low {
                    line.low_forward
                } else {
                    line.high_forward
                },
                their_forwarding: if low {
                    line.high_forward
                } else {
                    line.low_forward
                },
            }
        }
    }
    #[derive(SimpleObject)]
    struct LinePage {
        nodes: Vec<Relationship>,
        end_cursor: Option<String>,
        has_next_page: bool,
    }
    #[derive(SimpleObject)]
    struct Quote {
        amount: String,
        fee: String,
        total: String,
        symbol: String,
        payee: AccountNumber,
        expires_at: String,
        reference: String,
        encoded_route: String,
    }
    #[derive(SimpleObject)]
    struct Settings {
        request_only: bool,
        routing_ready: bool,
        server_time: String,
    }
    #[derive(SimpleObject)]
    struct PaymentRequest {
        hash: String,
        symbol: String,
        amount: String,
        expires_at: String,
        payer: Option<AccountNumber>,
        consumed: bool,
        revoked: bool,
    }
    #[derive(SimpleObject)]
    struct RequestPage {
        nodes: Vec<PaymentRequest>,
        end_cursor: Option<String>,
        has_next_page: bool,
    }
    #[derive(SimpleObject)]
    struct Activity {
        id: String,
        kind: String,
        symbol: String,
        incoming: Option<AccountNumber>,
        outgoing: Option<AccountNumber>,
        received: String,
        sent: String,
        earned: String,
        memo: String,
        time: String,
    }
    #[derive(SimpleObject)]
    struct ActivityPage {
        nodes: Vec<Activity>,
        end_cursor: Option<String>,
        has_next_page: bool,
    }

    #[Object]
    impl Query {
        /// No user argument: authenticated identity is supplied by http-server.
        async fn lines(&self, first: Option<u32>, after: Option<String>) -> Result<LinePage> {
            let user = self.user()?;
            let count = first.unwrap_or(100).clamp(1, 100) as usize;
            let table = Lines::with_service(favor::SERVICE);
            let min = (user, String::new(), AccountNumber::MIN);
            let max = (user, "ZZZZZZZZZZZZZ".into(), AccountNumber::MAX);
            // Read only the two indexes belonging to the session owner.
            let low: Vec<_> = table
                .get_index_by_low()
                .range(min.clone()..=max.clone())
                .take(2001)
                .collect();
            let high: Vec<_> = table
                .get_index_by_high()
                .range(min..=max)
                .take(2001)
                .collect();
            if low.len() > 2000 || high.len() > 2000 {
                return Err(Error::new("Too many relationships for this query budget"));
            }
            let mut rows: Vec<_> = low
                .into_iter()
                .chain(high)
                .map(|l| Relationship::new(l, user))
                .filter(|l| after.as_ref().map_or(true, |a| l.cursor > *a))
                .collect();
            rows.sort_by(|a, b| a.cursor.cmp(&b.cursor));
            let has_next_page = rows.len() > count;
            rows.truncate(count);
            Ok(LinePage {
                end_cursor: rows.last().map(|l| l.cursor.clone()),
                nodes: rows,
                has_next_page,
            })
        }

        /// Search is subjective. The complete self-contained encrypted route is
        /// signed into the transaction; execution never repeats this search.
        async fn quote(
            &self,
            payee: AccountNumber,
            symbol: String,
            amount: String,
            reference: String,
            request_secret: Option<String>,
        ) -> Result<Quote> {
            let payer = self.user()?;
            let value = routing::units(&amount).map_err(|_| Error::new(favor::crypto::INVALID))?;
            let mut random = [0_u8; 360];
            unsafe {
                psibase::native_raw::getRandom(random.as_mut_ptr(), random.len());
            }
            let (context, encoded_route) = favor::quote(
                payer,
                payee,
                &symbol,
                value,
                &reference,
                request_secret.as_deref(),
                &random,
            )
            .map_err(Error::new)?;
            Ok(Quote {
                amount: routing::decimal(value),
                fee: routing::decimal(context.total - value),
                total: routing::decimal(context.total),
                symbol,
                payee,
                expires_at: context.expires_at.to_string(),
                reference,
                encoded_route,
            })
        }
        async fn settings(&self) -> Result<Settings> {
            let user = self.user()?;
            Ok(Settings {
                request_only: Preferences::with_service(favor::SERVICE)
                    .get_index_pk()
                    .get(&user)
                    .is_some_and(|p| p.request_only),
                routing_ready: RouteKeys::with_service(favor::SERVICE)
                    .get_index_pk()
                    .get(&0)
                    .is_some(),
                server_time: now().to_string(),
            })
        }
        async fn requests(&self, first: Option<u32>, after: Option<String>) -> Result<RequestPage> {
            let user = self.user()?;
            let count = first.unwrap_or(30).clamp(1, 100) as usize;
            let table = Requests::with_service(favor::SERVICE);
            let start = after.unwrap_or_default();
            let mut rows: Vec<_> = table
                .get_index_by_owner()
                .range((user, start.clone())..=(user, "g".into()))
                .filter(|r| r.hash > start)
                .take(count + 1)
                .collect();
            let has_next_page = rows.len() > count;
            rows.truncate(count);
            let end_cursor = rows.last().map(|r| r.hash.clone());
            let nodes = rows
                .into_iter()
                .map(|r| PaymentRequest {
                    hash: r.hash,
                    symbol: r.symbol,
                    amount: routing::decimal(r.amount),
                    expires_at: r.expires_at.to_string(),
                    payer: r.payer,
                    consumed: r.consumed,
                    revoked: r.revoked,
                })
                .collect();
            Ok(RequestPage {
                nodes,
                end_cursor,
                has_next_page,
            })
        }

        async fn activity(
            &self,
            first: Option<u32>,
            before: Option<String>,
        ) -> Result<ActivityPage> {
            let user = self.user()?;
            let count = first.unwrap_or(30).clamp(1, 100) as usize;
            let max = match before {
                Some(b) => b
                    .parse::<u64>()
                    .map_err(|_| Error::new("Invalid activity cursor"))?,
                None => u64::MAX,
            };
            let table = Receipts::with_service(favor::SERVICE);
            let mut rows: Vec<_> = table
                .get_index_pk()
                .range((user, 0)..(user, max))
                .rev()
                .take(count + 1)
                .collect();
            let has_next_page = rows.len() > count;
            rows.truncate(count);
            let end_cursor = rows.last().map(|r| r.id.to_string());
            let nodes = rows
                .into_iter()
                .map(|r| Activity {
                    id: r.id.to_string(),
                    kind: r.kind,
                    symbol: r.symbol,
                    incoming: r.incoming,
                    outgoing: r.outgoing,
                    received: routing::decimal(r.received),
                    sent: routing::decimal(r.sent),
                    earned: routing::decimal(if r.received > 0 && r.sent > 0 {
                        r.received - r.sent
                    } else {
                        0
                    }),
                    memo: r.memo,
                    time: r.time.to_string(),
                })
                .collect();
            Ok(ActivityPage {
                nodes,
                end_cursor,
                has_next_page,
            })
        }
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        assert_eq!(
            get_sender(),
            services::http_server::SERVICE,
            "Only http-server may supply query identity"
        );
        serve_graphql(&request, Query { user }).or_else(|| serve_graphiql(&request))
    }
}
