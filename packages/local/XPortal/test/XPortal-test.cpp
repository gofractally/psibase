#include "XPortalTest.hpp"


TEST_CASE("status, requests switch, and seeded pricing")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice   = AccountNumber{"alice"};
   auto creator = XPortal::creatorAccount;

   auto status = t.http<Status>(forwarded("GET", "/status"));
   CHECK(status.requests_enabled == false);
   CHECK(status.billing_enabled == false);
   CHECK(status.ready == false);
   REQUIRE(status.conditions.size() == 3);
   CHECK(status.conditions[0].id == "creator_ready");
   CHECK(status.conditions[0].ok == false);
   CHECK(status.conditions[1].id == "x_configured");
   CHECK(status.conditions[1].ok == false);
   CHECK(status.conditions[2].id == "stripe_configured");
   CHECK(status.conditions[2].ok == false);

   CHECK(t.http(forwarded("GET", "/admin/config")).status == HttpStatus::unauthorized);
   CHECK(t.http(forwarded("POST", "/status")).status == HttpStatus::methodNotAllowed);
   CHECK(t.get(XPortal::service, "/missing").status == HttpStatus::notFound);

   auto config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.requests_enabled == false);
   CHECK(!config.price_per_token_usd_micros.has_value());
   CHECK(config.free_tier.enabled);
   CHECK(!config.free_tier.usd_cents.has_value());
   CHECK(!config.free_tier.tokens.has_value());
   CHECK(!config.producer.has_value());
   CHECK(!config.account.has_value());
   CHECK(!config.creator_pubkey.has_value());

   auto hidden = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(hidden.free.has_value());
   CHECK(hidden.free->usd_cents == 0);
   CHECK(hidden.free->tokens.value == 0);
   CHECK(hidden.tiers.empty());

   setProducer(t, "myprod");
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.producer == AccountNumber{"myprod"});

   XAdmin{}.open<AdminAccountTable>().put(AdminAccountRow{alice});
   auto token = t.login(alice, XPortal::service);
   config     = t.http<AdminConfig>(forwarded("GET", "/admin/config", token));
   CHECK(config.account == alice);

   auto missing = t.http(HttpRequestBuilder{}.put(XPortal::service, "/admin/config",
                                                  RawBody{"application/json", "{}"}));
   CHECK(missing.status == HttpStatus::badRequest);
   CHECK(std::string(missing.body.begin(), missing.body.end()) ==
         "requests_enabled, price_per_token_usd_micros, free_tier, x, stripe, or tiers is "
         "required\n");
   auto badType =
       t.http(HttpRequestBuilder{}.put(XPortal::service, "/admin/config",
                                       RawBody{"application/json", R"({"requests_enabled":1})"}));
   CHECK(badType.status == HttpStatus::badRequest);
   CHECK(std::string(badType.body.begin(), badType.body.end()) ==
         "requests_enabled must be a boolean\n");
   CHECK(t.http(HttpRequestBuilder{}.put(XPortal::service, "/admin/config",
                                         RawBody{"text/plain", "x"}))
             .status == HttpStatus::unsupportedMediaType);

   t.put(XPortal::service, "/admin/config", RequestsSwitch{.requests_enabled = true});
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.requests_enabled);
   CHECK(!config.price_per_token_usd_micros.has_value());
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.requests_enabled);

   t.put(XPortal::service, "/admin/config", RequestsSwitch{.requests_enabled = false});
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.requests_enabled == false);
   CHECK(!config.price_per_token_usd_micros.has_value());

   configureX(t);
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[1].ok);

   std::vector<AllowedAction> allowed{{Tokens::service, MethodNumber{"debit"}}};
   REQUIRE(t.from(alice).to<AuthScope>().newAccount(creator, agentPub, alice, allowed).succeeded());
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[0].ok == false);

   XPortal{}.open<AgentKeyTable>().put(
       AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = agentPub});
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.creator_pubkey == agentPub);
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[0].ok);
   CHECK(status.ready);

   XPortal{}.open<AgentKeyTable>().put(
       AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = otherPub});
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[0].ok == false);

   XPortal{}.open<AgentKeyTable>().put(
       AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = agentPub});

   auto billed = enableBilling(t, alice);
   auto sys    = billed.id;
   auto scale  = uint64_t{1};
   for (uint8_t i = 0; i < billed.precision; ++i)
      scale *= 10;
   auto cost = billed.cost;

   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   REQUIRE(config.price_per_token_usd_micros.has_value());
   auto price = (uint64_t{2'500'000} * scale) / cost;
   CHECK(*config.price_per_token_usd_micros == price);
   CHECK(config.free_tier.enabled);
   CHECK(config.free_tier.usd_cents == 250);
   REQUIRE(config.free_tier.tokens.has_value());
   CHECK(config.free_tier.tokens->value == (uint64_t{250} * 10'000 * scale) / price);
   REQUIRE(config.tiers.size() == 3);
   CHECK(config.tiers[0].label == "Small");
   CHECK(config.tiers[0].usd_cents == 500);
   CHECK(config.tiers[1].label == "Medium");
   CHECK(config.tiers[1].usd_cents == 1250);
   CHECK(config.tiers[2].label == "Large");
   CHECK(config.tiers[2].usd_cents == 2500);
   auto again = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(again.price_per_token_usd_micros == config.price_per_token_usd_micros);
   CHECK(again.requests_enabled == false);
   CHECK(again.tiers.size() == 3);

   auto offers = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(offers.free.has_value());
   CHECK(offers.free->usd_cents == 250);
   CHECK(offers.free->buffer_multiple == 1);
   CHECK(offers.free->tokens.value == config.free_tier.tokens->value);
   REQUIRE(offers.tiers.size() == 3);
   CHECK(offers.tiers[0].index == 0);
   CHECK(offers.tiers[0].label == "Small");
   CHECK(offers.tiers[0].usd_cents == 500);
   CHECK(offers.tiers[0].buffer_multiple == 2);
   CHECK(offers.tiers[1].index == 1);
   CHECK(offers.tiers[1].label == "Medium");
   CHECK(offers.tiers[1].usd_cents == 1250);
   CHECK(offers.tiers[1].buffer_multiple == 5);
   CHECK(offers.tiers[2].index == 2);
   CHECK(offers.tiers[2].label == "Large");
   CHECK(offers.tiers[2].usd_cents == 2500);
   CHECK(offers.tiers[2].buffer_multiple == 10);
   REQUIRE(offers.tiers[2].tokens.value > offers.free->tokens.value);

   status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, false, false);
   CHECK(status.ready == false);

   auto grant = offers.tiers[2].tokens.value;
   REQUIRE(grant > 0);
   auto inviteCost = t.from(alice).to<Invite>().getInvCost(1, Quantity{grant}).returnVal();
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, VirtualServer::service, cost, "").succeeded());
   REQUIRE(t.from(alice).to<VirtualServer>().buy_res_for(cost, creator, "").succeeded());
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, creator, inviteCost, "").succeeded());
   REQUIRE(t.from(creator)
               .with(KeyList{{agentPub, agentPriv}})
               .to<Tokens>()
               .debit(sys, alice, inviteCost, "")
               .succeeded());

   configureStripe(t);
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[1].ok);
   CHECK(status.conditions[2].ok);
   CHECK(status.conditions[4].ok);
   CHECK(status.ready);
}

TEST_CASE("producer funds ac-creator when billing is enabled")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice = AccountNumber{"alice"};
   setProducer(t, "alice");
   XAdmin{}.open<AdminAccountTable>().put(AdminAccountRow{alice});
   auto token = t.login(alice, XPortal::service);
   auto first = t.http(keygenRequest(token));
   CHECK(first.status == HttpStatus::ok);
   auto body = std::string(first.body.begin(), first.body.end());
   CHECK(body.find("PRIVATE KEY") == std::string::npos);
   body.push_back('\0');
   psio::json_token_stream stream(body.data());
   auto                    key = psio::from_json<AgentKey>(stream);
   CHECK(key.name == XPortal::creatorAgent);
   requireStoredKey(key.pubkey);

   auto billed = enableBilling(t, alice, 5);
   auto sys    = billed.id;
   auto cost   = billed.cost;

   auto config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   REQUIRE(config.free_tier.tokens.has_value());
   auto grant = config.free_tier.tokens->value;
   REQUIRE(grant > 0);
   REQUIRE(grant <= std::numeric_limits<uint64_t>::max() / 100);
   REQUIRE(cost <= std::numeric_limits<uint64_t>::max() / 100);
   Quantity funded{grant * 100};
   Quantity buffer{cost * 100};
   auto     balance = t.from(alice).to<Tokens>().getBalance(sys, alice).returnVal();
   REQUIRE(balance.value >= funded.value + buffer.value);

   createCreator(t, alice, key.pubkey, buffer, funded);

   auto row = t.from(alice).to<AuthScope>().get(XPortal::creatorAccount).returnVal();
   REQUIRE(row.has_value());
   CHECK(row->owner == alice);
   CHECK(row->pubkey == key.pubkey);
   CHECK(row->allowed == XPortal::creatorAllowed());

   auto status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, false, true);
   CHECK(t.from(alice).to<Tokens>().getBalance(sys, XPortal::creatorAccount).returnVal().value ==
         0);
   CHECK(t.from(alice)
             .to<Tokens>()
             .getSharedBal(sys, alice, XPortal::creatorAccount)
             .returnVal()
             .value == funded.value);
   auto sub = t.from(VirtualServer::service)
                  .to<Tokens>()
                  .getSubBal(sys, XPortal::creatorAccount.str())
                  .returnVal();
   REQUIRE(sub.has_value());
   CHECK(sub->value == buffer.value);

   auto conflict = t.http(keygenRequest(token));
   CHECK(conflict.status == HttpStatus::conflict);
   requireStoredKey(key.pubkey);
}

TEST_CASE("provision signs the billed invite actions as ac-creator")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   openBilledPortal(t);
   openSession("owner", "42");

   auto receipt = t.http<SignupReceipt>(signupRequest(9, "owner"));
   CHECK(signupRow(receipt.signup_id)->x_id == "42");

   // The tester has no node to push to, so a run that gets past signTx still fails.
   auto fired = runAs(t, AccountNumber{}, XTimer::service, "runOne", std::tuple{});
   REQUIRE(fired.error.has_value());
   CHECK(fired.error->find("Failed to sign transaction") == std::string::npos);
   CHECK(signupRow(receipt.signup_id)->attempts == 1);
}

TEST_CASE("provision commits one attempt before signing")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice   = AccountNumber{"alice"};
   auto creator = XPortal::creatorAccount;
   XAdmin{}.open<AdminAccountTable>().put(AdminAccountRow{alice});
   auto token = t.login(alice, XPortal::service);
   storeCreatorKey();
   // Debit-only whitelist: createInvite is outside it, so signTx aborts after the attempt commits.
   transactor<AuthScope> scope{alice, AuthScope::service};
   expect(t.pushTransaction(t.makeTransaction(
       {scope.newAccount(creator, agentPub, alice,
                         std::vector<AllowedAction>{{Tokens::service, MethodNumber{"debit"}}})})));
   configureX(t);
   t.put(XPortal::service, "/admin/config", RequestsSwitch{.requests_enabled = true});
   openSession("owner", "42");
   openSession("other", "99", "jane");

   auto created = t.http<SignupReceipt>(signupRequest(21, "owner"));
   auto fired   = runAs(t, AccountNumber{}, XTimer::service, "runOne", std::tuple{});
   REQUIRE(fired.error.has_value());
   CHECK(fired.error->find("Failed to sign transaction") != std::string::npos);
   auto row = signupRow(created.signup_id);
   REQUIRE(row.has_value());
   CHECK(row->state == "queued");
   CHECK(row->attempts == 1);
   CHECK(row->last_error == "signing aborted");
   auto again =
       runAs(t, XTimer::service, XPortal::service, "provision", std::tuple{std::uint64_t{0}});
   CHECK(!again.error.has_value());
   CHECK(signupRow(created.signup_id)->attempts == 1);

   auto retryPath = "/admin/signups/" + created.signup_id + "/retry";
   CHECK(t.http(forwarded("POST", retryPath)).status == HttpStatus::unauthorized);
   CHECK(t.http(forwarded("GET", retryPath, token)).status == HttpStatus::methodNotAllowed);
   CHECK(t.http(forwarded("POST", "/admin/signups/invalid/retry", token)).status ==
         HttpStatus::badRequest);
   CHECK(t.http(forwarded("POST", retryPath, token)).status == HttpStatus::conflict);

   // Restart drops session bookkeeping but retains the interrupted signup.
   XPortal{}.open<ProvisionAttemptTable>().erase(row->id);
   XPortal{}.open<PendingPushTable>().put(PendingPush{.socket = 11, .signup = row->id});
   CHECK(t.http(forwarded("POST", retryPath, token)).status == HttpStatus::conflict);
   XPortal{}.open<PendingPushTable>().erase(std::int32_t{11});

   auto retried = t.http<SignupReceipt>(forwarded("POST", retryPath, token));
   CHECK(retried.signup_id == created.signup_id);
   CHECK(signupRow(created.signup_id)->attempts == 1);
   CHECK(t.http(forwarded("POST", retryPath, token)).status == HttpStatus::conflict);
   auto retryFired = runAs(t, AccountNumber{}, XTimer::service, "runOne", std::tuple{});
   REQUIRE(retryFired.error.has_value());
   CHECK(signupRow(created.signup_id)->attempts == 2);
   CHECK(signupRow(created.signup_id)->invite_id == row->invite_id);
   CHECK(signupRow(created.signup_id)->token == row->token);
   CHECK(t.http(forwarded("POST", retryPath, token)).status == HttpStatus::conflict);

   XPortal{}.open<PendingPushTable>().put(PendingPush{.socket = 11, .signup = row->id});
   auto pushed = runAs(
       t, XHttp::service, XPortal::service, "onPushReply",
       std::tuple{std::int32_t{11},
                  HttpReply{.status = HttpStatus::ok, .body = psio::to_frac(TransactionTrace{})}});
   CHECK(!pushed.error.has_value());
   auto done =
       t.http<SignupView>(withSession(forwarded("GET", "/signup/" + created.signup_id), "owner"));
   CHECK(done.state == "invited");
   CHECK(done.token == "token-21");
   CHECK(!XPortal{}.open<ProvisionAttemptTable>().get(row->id));
   CHECK(t.http(forwarded("POST", retryPath, token)).status == HttpStatus::conflict);

   auto second = t.http<SignupReceipt>(signupRequest(22, "other"));
   auto claimed =
       runAs(t, XTimer::service, XPortal::service, "provision", std::tuple{std::uint64_t{1}});
   REQUIRE(claimed.error.has_value());
   XPortal{}.open<PendingPushTable>().put(
       PendingPush{.socket = 12, .signup = signupRow(second.signup_id)->id});
   auto failedPush = runAs(
       t, XHttp::service, XPortal::service, "onPushReply",
       std::tuple{std::int32_t{12}, HttpReply{.status = HttpStatus::ok,
                                              .body   = psio::to_frac(TransactionTrace{
                                                    .error = std::string{"invite id is taken"}})}});
   CHECK(!failedPush.error.has_value());
   auto hidden = t.http(withSession(forwarded("GET", "/signup/" + second.signup_id), "other"));
   CHECK(hidden.status == HttpStatus::ok);
   CHECK(replyText(hidden).find("invite id is taken") == std::string::npos);
   auto view =
       t.http<SignupView>(withSession(forwarded("GET", "/signup/" + second.signup_id), "other"));
   CHECK(view.state == "failed");
   CHECK(!view.token.has_value());
   auto rows =
       t.http<std::vector<FailedSignup>>(forwarded("GET", "/admin/signups?state=failed", token));
   REQUIRE(rows.size() == 1);
   CHECK(rows[0].id == second.signup_id);
   CHECK(rows[0].attempts == 1);
   CHECK(rows[0].last_error == "invite id is taken");
}

TEST_CASE("admin recovery cannot replay a completed invite or an unpaid signup")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto id   = storePendingSignup(23, "42");
   auto path = "/admin/signups/" +
               toBase64Url({reinterpret_cast<const char*>(id.data()), id.size()}) + "/retry";
   auto retry = [&]
   { return t.http(HttpRequestBuilder{}.post(XPortal::service, path, EmptyBody{})); };
   CHECK(retry().status == HttpStatus::conflict);
   auto table   = XPortal{}.open<SignupTable>();
   auto row     = *table.get(id);
   row.state    = "queued";
   row.attempts = 1;
   table.put(row);
   REQUIRE(t.from(AccountNumber{"alice"})
               .to<Invite>()
               .createInvite(row.invite_id, row.payload, 1, false,
                             Quantity{static_cast<Quantity::Quantity_t>(0)}, std::nullopt)
               .succeeded());
   auto refused = retry();
   CHECK(refused.status == HttpStatus::conflict);
   CHECK(replyText(refused) == "signup invite already exists\n");
   CHECK(table.get(id)->attempts == 1);
   CHECK(!XPortal{}.open<ProvisionAttemptTable>().get(id));
}

TEST_CASE("X credentials are set field by field and the secret is masked")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);

   auto config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(!config.x.client_id.has_value());
   CHECK(!config.x.client_secret.has_value());
   CHECK(config.x.api_base == "https://api.x.com");

   CHECK(putConfigExpectBadRequest(t, R"({"x":"id"})") == "x must be an object\n");
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_id":""}})") ==
         "x.client_id must be a non-empty string\n");
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_secret":true}})") ==
         "x.client_secret must be a non-empty string\n");
   for (auto bad : {"api.x.com", "https://api.x.com/", "https://api.x.com/2", "https://"})
      CHECK(putConfigExpectBadRequest(t, std::format(R"({{"x":{{"api_base":"{}"}}}})", bad)) ==
            "x.api_base must be an http or https origin\n");
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_id":"kept","api_base":"bad"}})")
             .starts_with("x.api_base"));
   CHECK(!t.get<AdminConfig>(XPortal::service, "/admin/config").x.client_id.has_value());

   configureX(t);
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.x.client_id == "client-id");
   CHECK(config.x.client_secret == "abcd");
   CHECK(config.x.api_base == "https://api.x.com");
   CHECK(XPortal{}.open<PortalConfigTable>().get({})->x.client_secret == "client-secret-abcd");

   t.put(XPortal::service, "/admin/config",
         RawBody{"application/json", R"({"x":{"api_base":"http://127.0.0.1:9"}})"});
   config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.x.client_id == "client-id");
   CHECK(config.x.client_secret == "abcd");
   CHECK(config.x.api_base == "http://127.0.0.1:9");
   CHECK(config.requests_enabled == false);
}

TEST_CASE("X OAuth callback URL follows the browser-facing origin")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);

   auto config = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(config.x_callback_url == "http://x-portal.psibase.io/auth/x/callback");

   configureX(t);
   auto authorize = startXSignIn(t);
   CHECK(authorize.redirect_uri == config.x_callback_url);

   authorize = startXSignIn(t, {{"Host", "x-portal.psibase.io:9090"}});
   CHECK(authorize.redirect_uri == "http://x-portal.psibase.io:9090/auth/x/callback");

   authorize =
       startXSignIn(t, {{"Host", "x-portal.psibase.io:9090"}, {"X-Forwarded-Proto", "https"}});
   CHECK(authorize.redirect_uri == "https://x-portal.psibase.io:9090/auth/x/callback");
}

TEST_CASE("Sign in with X starts PKCE and consumes its state once")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);

   auto unconfigured = t.http(forwarded("GET", "/auth/x/start"));
   CHECK(unconfigured.status == HttpStatus::serviceUnavailable);
   configureX(t);
   CHECK(t.http(forwarded("POST", "/auth/x/start")).status == HttpStatus::methodNotAllowed);

   auto authorize = startXSignIn(t);
   CHECK(authorize.response_type == "code");
   CHECK(authorize.client_id == "client-id");
   CHECK(authorize.redirect_uri == "http://x-portal.psibase.io/auth/x/callback");
   CHECK(authorize.scope == "users.read tweet.read");
   CHECK(authorize.code_challenge_method == "S256");
   CHECK(authorize.state.size() == 43);

   auto started = XPortal{}.open<XAuthRequestTable>().get(authorize.state);
   REQUIRE(started.has_value());
   CHECK(started->code_verifier.size() == 43);
   CHECK(started->code_verifier != started->state);
   CHECK(started->redirect_uri == authorize.redirect_uri);
   auto hash = sha256(started->code_verifier.data(), started->code_verifier.size());
   CHECK(authorize.code_challenge ==
         toBase64Url({reinterpret_cast<const char*>(hash.data()), hash.size()}));

   auto callback = [&](std::string_view query)
   { return t.http(forwarded("GET", std::format("/auth/x/callback?{}", query))); };

   CHECK(callback("code=abc").status == HttpStatus::badRequest);
   CHECK(callback("code=abc&state=unknown").status == HttpStatus::badRequest);

   // X sends the user back without a code when they cancel.
   auto cancelled = callback("error=access_denied&state=" + authorize.state);
   CHECK(cancelled.status == HttpStatus::found);
   CHECK(cancelled.getHeader("Location") == "/");
   CHECK(!XPortal{}.open<XAuthRequestTable>().get(authorize.state).has_value());
   CHECK(callback("code=abc&state=" + authorize.state).status == HttpStatus::badRequest);

   auto expired = startXSignIn(t);
   auto row     = XPortal{}.open<XAuthRequestTable>().get(expired.state);
   REQUIRE(row.has_value());
   row->expires = TimePointUSec{};
   XPortal{}.open<XAuthRequestTable>().put(*row);
   CHECK(callback("code=abc&state=" + expired.state).status == HttpStatus::badRequest);
   CHECK(!XPortal{}.open<XAuthRequestTable>().get(expired.state).has_value());

   // The next start drops authorizations that have expired.
   auto stale = startXSignIn(t);
   row        = XPortal{}.open<XAuthRequestTable>().get(stale.state);
   REQUIRE(row.has_value());
   row->expires = TimePointUSec{};
   XPortal{}.open<XAuthRequestTable>().put(*row);
   auto fresh = startXSignIn(t);
   CHECK(!XPortal{}.open<XAuthRequestTable>().get(stale.state).has_value());
   CHECK(XPortal{}.open<XAuthRequestTable>().get(fresh.state).has_value());

   // The tester cannot reach X, so the exchange fails, but the state is spent.
   CHECK(callback("code=abc&state=" + fresh.state).status != HttpStatus::found);
   CHECK(!XPortal{}.open<XAuthRequestTable>().get(fresh.state).has_value());
}

TEST_CASE("an X session cookie identifies the user until logout or expiry")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);

   CHECK(t.http(forwarded("GET", "/me")).status == HttpStatus::unauthorized);
   CHECK(t.http(withSession(forwarded("GET", "/me"), "unknown")).status ==
         HttpStatus::unauthorized);

   auto future = std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now()) +
                 std::chrono::hours{1};
   XPortal{}.open<XSessionTable>().put(
       XSession{.session_id = "live", .x_id = "42", .handle = "jack", .expires = future});
   XPortal{}.open<XSessionTable>().put(
       XSession{.session_id = "old", .x_id = "42", .handle = "jack", .expires = TimePointUSec{}});

   auto me = t.http<XIdentity>(withSession(forwarded("GET", "/me"), "live"));
   CHECK(me.x_id == "42");
   CHECK(me.handle == "jack");

   CHECK(t.http(withSession(forwarded("GET", "/me"), "old")).status == HttpStatus::unauthorized);
   CHECK(!XPortal{}.open<XSessionTable>().get(std::string{"old"}).has_value());

   CHECK(t.http(withSession(forwarded("GET", "/auth/logout"), "live")).status ==
         HttpStatus::methodNotAllowed);
   auto logout = t.http(withSession(forwarded("POST", "/auth/logout"), "live"));
   CHECK(logout.status == HttpStatus::ok);
   CHECK(logout.getHeader("Set-Cookie") ==
         "XPORTAL_SESSION=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
   CHECK(!XPortal{}.open<XSessionTable>().get(std::string{"live"}).has_value());
   CHECK(t.http(withSession(forwarded("GET", "/me"), "live")).status == HttpStatus::unauthorized);
}

TEST_CASE("one free signup per X user")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice = AccountNumber{"alice"};
   REQUIRE(t.from(alice)
               .to<AuthScope>()
               .newAccount(XPortal::creatorAccount, agentPub, alice,
                           std::vector<AllowedAction>{{Tokens::service, MethodNumber{"debit"}}})
               .succeeded());
   XPortal{}.open<AgentKeyTable>().put(
       AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = agentPub});
   t.put(XPortal::service, "/admin/config", RequestsSwitch{.requests_enabled = true});
   REQUIRE(t.get<Status>(XPortal::service, "/status").ready);

   openSession("owner", "42");
   t.http<SignupReceipt>(signupRequest(1, "owner"));
   auto again = t.http(signupRequest(2, "owner"));
   CHECK(again.status == HttpStatus::conflict);
   CHECK(replyText(again) == "free signup already exists\n");
}

TEST_CASE("the Stripe webhook queues a paid signup only when Stripe signed it")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   configureStripe(t);
   auto id     = storePendingSignup(7, "42");
   auto idText = toBase64Url({reinterpret_cast<const char*>(id.data()), id.size()});
   auto paid   = paidCheckoutEvent(idText);

   CHECK(postWebhook(t, paid, stripeSignature("whsec_other", paid)).status ==
         HttpStatus::badRequest);
   CHECK(XPortal{}.open<SignupTable>().get(id)->state == "pending");

   CHECK(postWebhook(t, paid, stripeSignature(*testStripe.webhook_secret, paid)).status ==
         HttpStatus::ok);
   CHECK(XPortal{}.open<SignupTable>().get(id)->state == "queued");
}

TEST_CASE("paid tier readiness covers the paid grant")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice   = AccountNumber{"alice"};
   auto creator = XPortal::creatorAccount;
   auto billed = openBilledPortal(t);
   t.put(XPortal::service, "/admin/config",
         RawBody{"application/json", R"({"tiers":[{"label":"Paid","usd_cents":5000}]})"});

   auto offers = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(offers.free.has_value());
   CHECK(offers.free->buffer_multiple == 1);
   REQUIRE(offers.tiers.size() == 1);
   CHECK(offers.tiers[0].index == 0);
   CHECK(offers.tiers[0].usd_cents == 5000);
   CHECK(offers.tiers[0].buffer_multiple == 20);
   auto paidTokens = offers.tiers[0].tokens;
   REQUIRE(paidTokens.value > offers.free->tokens.value);

   auto inviteCost = [&]
   { return t.from(alice).to<Invite>().getInvCost(1, paidTokens).returnVal(); };
   auto creatorBalance = [&]
   { return t.from(alice).to<Tokens>().getBalance(billed.id, creator).returnVal(); };
   REQUIRE(inviteCost().value > creatorBalance().value);

   auto status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, false, true);
   CHECK(status.ready == false);
   openSession("payer", "42");
   auto blocked = t.http(withSession(
       HttpRequestBuilder{}
           .header("X-Forwarded-For", "203.0.113.8")
           .post(XPortal::service, "/signup",
                 SignupBody{
                     .invite_id = 7, .payload = invitePayload(7), .token = "token-7", .tier = 0}),
       "payer"));
   CHECK(blocked.status == HttpStatus::forbidden);

   auto keys = KeyList{{agentPub, agentPriv}};
   auto cost = inviteCost();
   auto held = creatorBalance();
   REQUIRE(cost.value > held.value);
   // The funding transaction is billed, which moves the reserve's spot price.
   Quantity extra{cost.value - held.value + 64};
   REQUIRE(t.from(alice).to<Tokens>().credit(billed.id, creator, extra, "").succeeded());
   REQUIRE(t.from(creator).with(keys).to<Tokens>().debit(billed.id, alice, extra, "").succeeded());
   status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, true, true);
   CHECK(status.ready);
   CHECK(creatorBalance().value >= inviteCost().value);

   auto missing = t.http(withSession(
       HttpRequestBuilder{}
           .header("X-Forwarded-For", "203.0.113.8")
           .post(XPortal::service, "/signup",
                 SignupBody{
                     .invite_id = 8, .payload = invitePayload(8), .token = "token-8", .tier = 1}),
       "payer"));
   CHECK(missing.status == HttpStatus::badRequest);
   CHECK(replyText(missing) == "tier is not offered\n");
}

TEST_CASE("paid tiers stay hidden until billing is enabled")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   t.put(XPortal::service, "/admin/config",
         RawBody{"application/json", R"({"tiers":[{"label":"Paid","usd_cents":500}]})"});

   auto offers = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(offers.free.has_value());
   CHECK(offers.tiers.empty());

   enableBilling(t, AccountNumber{"alice"});
   offers = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(offers.tiers.size() == 1);
   CHECK(offers.tiers[0].label == "Paid");
   CHECK(offers.tiers[0].usd_cents == 500);
   CHECK(offers.tiers[0].index == 0);
   CHECK(offers.tiers[0].buffer_multiple == 2);
}

TEST_CASE("admin config refuses to leave no tier offered")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   enableBilling(t, AccountNumber{"alice"});
   auto before = t.get<AdminConfig>(XPortal::service, "/admin/config");
   REQUIRE(before.free_tier.enabled);
   REQUIRE(!before.tiers.empty());

   CHECK(putConfigExpectBadRequest(t, R"({"free_tier":{"enabled":false},"tiers":[]})") ==
         "the free tier or a paid tier must be offered\n");
   auto after = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(after.free_tier.enabled);
   CHECK(after.tiers.size() == before.tiers.size());
}
