#include <services/local/XPortal.hpp>

#include <format>
#include <limits>
#include <tuple>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/base64.hpp>
#include <psibase/fileUtil.hpp>
#include <psibase/testerApi.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XKeys.hpp>
#include <services/local/XTimer.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Tokens.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace SystemService::AuthSig;
using namespace UserService;
using UserService::InviteNs::Invite;
using UserService::InviteNs::InvPayload;

namespace
{
   struct WasmFileBody
   {
      std::string       contentType() const { return "application/wasm"; }
      std::vector<char> body() const { return readWholeFile(filename); }
      std::string       filename;
   };

   struct RawBody
   {
      std::string       contentType() const { return type; }
      std::vector<char> body() const { return {text.begin(), text.end()}; }
      std::string       type;
      std::string       text;
   };

   struct RequestsSwitch
   {
      bool requests_enabled = false;
      PSIO_REFLECT(RequestsSwitch, requests_enabled)
   };

   struct RequestsAndPrice
   {
      bool     requests_enabled           = false;
      uint64_t price_per_token_usd_micros = 0;
      PSIO_REFLECT(RequestsAndPrice, requests_enabled, price_per_token_usd_micros)
   };

   auto pubFromPem = [](std::string_view pem)
   { return SubjectPublicKeyInfo{parseSubjectPublicKeyInfo(pem)}; };
   auto privFromPem = [](std::string_view pem) { return PrivateKeyInfo{parsePrivateKeyInfo(pem)}; };

   const auto agentPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n");
   const auto agentPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
       "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
       "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
       "-----END PRIVATE KEY-----\n");
   const auto otherPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
       "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
       "-----END PUBLIC KEY-----\n");

   const std::vector<std::string> portalPackages{"TestDefault", "TokenUsers", "AuthScope",
                                                 "Invite"};

   struct XCredentials
   {
      XConfig x;
      PSIO_REFLECT(XCredentials, x)
   };

   const XConfig testX{.client_id = "client-id", .client_secret = "client-secret-abcd"};

   void requireBillingReadiness(const Status& status, bool tokensOk, bool resourcesOk)
   {
      REQUIRE(status.billing_enabled);
      REQUIRE(status.conditions.size() == 5);
      CHECK(status.conditions[0].id == "creator_ready");
      CHECK(status.conditions[0].ok);
      CHECK(status.conditions[1].id == "creator_tokens");
      CHECK(status.conditions[1].ok == tokensOk);
      CHECK(status.conditions[2].id == "creator_resources");
      CHECK(status.conditions[2].ok == resourcesOk);
      CHECK(status.conditions[3].id == "x_configured");
      CHECK(status.conditions[4].id == "stripe_configured");
   }

   std::vector<uint8_t> invitePayload(uint8_t seed)
   {
      auto packed = psio::to_frac(
          InvPayload{.fingerprint = std::vector<uint8_t>(32, seed), .secret = "secret"});
      return {packed.begin(), packed.end()};
   }

   void installPortal(DefaultTestChain& t)
   {
      t.put(XAdmin::service, "/services/" + XPortal::service.str() + "?isPrivileged=1",
            WasmFileBody{"XPortal.wasm"});
      t.post(XHttp::service, "/register_server",
             JsonBody{RegisteredServiceRow{XPortal::service, XPortal::service}});
   }

   void configureX(DefaultTestChain& t)
   {
      t.put(XPortal::service, "/admin/config", XCredentials{.x = testX});
   }

   HttpRequest forwarded(std::string_view method,
                         std::string_view target,
                         std::string_view token = {})
   {
      auto builder = HttpRequestBuilder{}.header("X-Forwarded-For", "203.0.113.8");
      if (!token.empty())
         builder.auth_bearer(token);
      if (method == "GET")
         return builder.get(XPortal::service, target);
      if (method == "POST")
         return builder.post(XPortal::service, target, EmptyBody{});
      return builder.request(XPortal::service, method, target);
   }

   void setProducer(DefaultTestChain& t, std::string_view name)
   {
      auto row = t.kvGet<HostConfigRow>(HostConfigRow::db, hostConfigKey());
      REQUIRE(row.has_value());
      row->config = std::format(R"({{"host":{{"hosts":["psibase.io"],"producer":"{}"}}}})", name);
      t.kvPut(HostConfigRow::db, row->key(), *row);
   }

   HttpRequest keygenRequest(std::string_view token = {})
   {
      return forwarded("POST", "/admin/agents/creator/keygen", token);
   }

   struct BilledToken
   {
      TID      id        = 0;
      uint8_t  precision = 0;
      uint64_t cost      = 0;
   };

   // `extraDrips` credits additional faucet drips before billing is enabled.
   // One drip is not enough to fund ac-creator at 100x the free grant.
   BilledToken enableBilling(DefaultTestChain& t, AccountNumber payer, int extraDrips = 0)
   {
      REQUIRE(t.to<VirtualServer>().init_billing(Tokens::service).succeeded());
      auto sysToken = t.from(payer).to<Tokens>().getSysToken().returnVal();
      REQUIRE(sysToken.has_value());
      auto cost = t.to<VirtualServer>().std_buffer_cost().returnVal().value;
      REQUIRE(cost != 0);
      auto faucet = AccountNumber{"faucet-tok"};
      REQUIRE(t.from(payer).to<Tokens>().debit(sysToken->id, faucet, 100'000'0000, "").succeeded());
      if (extraDrips != 0)
      {
         std::vector<Action> drips;
         for (int i = 0; i < extraDrips; ++i)
         {
            drips.push_back(Action{
                .sender  = faucet,
                .service = faucet,
                .method  = MethodNumber{"dispense"},
                .rawData = psio::convert_to_frac(std::tuple{payer}),
            });
         }
         expect(t.pushTransaction(t.makeTransaction(std::move(drips))));
         REQUIRE(t.from(payer)
                     .to<Tokens>()
                     .debit(sysToken->id, faucet, uint64_t(extraDrips) * 100'000'0000, "")
                     .succeeded());
      }
      Quantity resource{cost};
      REQUIRE(
          t.from(payer).to<Tokens>().credit(sysToken->id, VirtualServer::service, resource, "").succeeded());
      REQUIRE(t.from(payer)
                  .to<VirtualServer>()
                  .buy_res_for(resource, VirtualServer::service, "")
                  .succeeded());
      REQUIRE(
          t.from(payer).to<Tokens>().credit(sysToken->id, VirtualServer::service, resource, "").succeeded());
      REQUIRE(t.from(payer).to<VirtualServer>().buy_res(resource).succeeded());
      REQUIRE(t.to<VirtualServer>().enable_billing().succeeded());
      return {.id = sysToken->id, .precision = sysToken->precision.value, .cost = cost};
   }

   void requireStoredKey(const SubjectPublicKeyInfo& pub)
   {
      auto table = XKeys{}.open<KeyTable>();
      auto id    = sha256(pub.data.data(), pub.data.size());
      auto row   = table.get({XPortal::service, id});
      REQUIRE(row.has_value());
      CHECK(row->owner == XPortal::service);
      CHECK(getSubjectPublicKeyInfo(row->key) == pub);
   }

   void createCreator(DefaultTestChain&                 t,
                      AccountNumber                     producer,
                      const SubjectPublicKeyInfo&       pub,
                      const std::optional<Quantity>&    buffer  = {},
                      const std::optional<Quantity>&    grant   = {},
                      const std::vector<AllowedAction>& allowed = XPortal::creatorAllowed())
   {
      transactor<AuthScope>     scope{producer, AuthScope::service};
      transactor<Tokens>        tokens{producer, Tokens::service};
      transactor<VirtualServer> vserver{producer, VirtualServer::service};
      std::vector<Action>       actions{
          scope.newAccount(XPortal::creatorAccount, pub, producer, allowed)};
      REQUIRE(buffer.has_value() == grant.has_value());
      if (buffer)
      {
         auto sys = t.from(producer).to<Tokens>().getSysToken().returnVal();
         REQUIRE(sys.has_value());
         actions.push_back(tokens.credit(sys->id, VirtualServer::service, *buffer, ""));
         actions.push_back(vserver.buy_res_for(*buffer, XPortal::creatorAccount, ""));
         actions.push_back(tokens.credit(sys->id, XPortal::creatorAccount, *grant, ""));
      }
      expect(t.pushTransaction(t.makeTransaction(std::move(actions))));
   }

   std::string replyText(const HttpReply& reply)
   {
      return {reply.body.begin(), reply.body.end()};
   }

   HttpRequest withSession(HttpRequest request, std::string_view sessionId)
   {
      request.headers.push_back({"Cookie", std::format("XPORTAL_SESSION={}", sessionId)});
      return request;
   }

   HttpRequest signupRequest(uint32_t inviteId, std::optional<std::string_view> sessionId = {})
   {
      auto request = HttpRequestBuilder{}
                         .header("X-Forwarded-For", "203.0.113.8")
                         .post(XPortal::service, "/signup",
                               SignupBody{.invite_id = inviteId,
                                          .payload   = invitePayload(static_cast<uint8_t>(inviteId)),
                                          .token     = "token-" + std::to_string(inviteId)});
      if (!sessionId)
         return request;
      return withSession(std::move(request), *sessionId);
   }

   void openSession(std::string sessionId, std::string xId, std::string handle = "jack")
   {
      auto expires = std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now()) +
                     std::chrono::hours{1};
      XPortal{}.open<XSessionTable>().put(XSession{.session_id = std::move(sessionId),
                                                   .x_id       = std::move(xId),
                                                   .handle     = std::move(handle),
                                                   .expires    = expires});
   }

   void storeCreatorKey()
   {
      XPortal{}.open<AgentKeyTable>().put(
          AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = agentPub});
      XKeys{}.open<KeyTable>().put(
          KeyRow{.id    = sha256(agentPub.data.data(), agentPub.data.size()),
                 .owner = XPortal::service,
                 .key   = agentPriv});
   }

   Checksum256 idFrom(std::string_view text)
   {
      auto raw = fromBase64Url(text);
      REQUIRE(raw.size() == 32);
      Checksum256 id{};
      std::ranges::copy(raw, reinterpret_cast<char*>(id.data()));
      return id;
   }

   std::optional<Signup> signupRow(std::string_view idText)
   {
      return XPortal{}.open<SignupTable>().get(idFrom(idText));
   }

   struct AuthorizeQuery
   {
      std::string response_type;
      std::string client_id;
      std::string redirect_uri;
      std::string scope;
      std::string state;
      std::string code_challenge;
      std::string code_challenge_method;
      PSIO_REFLECT(AuthorizeQuery,
                   response_type,
                   client_id,
                   redirect_uri,
                   scope,
                   state,
                   code_challenge,
                   code_challenge_method)
   };

   AuthorizeQuery startXSignIn(DefaultTestChain& t,
                               std::vector<HttpHeader> extraHeaders = {})
   {
      auto builder = HttpRequestBuilder{}.header("X-Forwarded-For", "203.0.113.8");
      for (auto& header : extraHeaders)
         builder.header(std::move(header));
      auto reply = t.http(builder.get(XPortal::service, "/auth/x/start"));
      REQUIRE(reply.status == HttpStatus::found);
      auto location = reply.getHeader("Location");
      REQUIRE(location.has_value());
      auto query = location->find('?');
      REQUIRE(query != std::string_view::npos);
      CHECK(location->substr(0, query) == "https://x.com/i/oauth2/authorize");
      return HttpRequest{.target = std::string{location->substr(query)}}.query<AuthorizeQuery>();
   }

   std::string putConfigExpectBadRequest(DefaultTestChain& t, std::string_view json)
   {
      auto reply = t.http(HttpRequestBuilder{}.put(XPortal::service, "/admin/config",
                                                   RawBody{"application/json", std::string{json}}));
      CHECK(reply.status == HttpStatus::badRequest);
      return replyText(reply);
   }

   template <typename T>
   TransactionTrace runAs(DefaultTestChain&  t,
                          AccountNumber      sender,
                          AccountNumber      service,
                          std::string_view   method,
                          const T&           args)
   {
      return tester::runAction(t.nativeHandle(), RunMode::rpc, false,
                               Action{.sender  = sender,
                                      .service = service,
                                      .method  = MethodNumber{method},
                                      .rawData = psio::convert_to_frac(args)});
   }

   // Billing on, ac-creator funded for one free signup, X configured, and
   // requests open. ac-creator may also debit, which claims its grant here
   // instead of the plugin's auto-debit.
   BilledToken openBilledPortal(DefaultTestChain& t)
   {
      auto alice = AccountNumber{"alice"};
      setProducer(t, "alice");
      storeCreatorKey();
      auto billed = enableBilling(t, alice, 5);

      auto config = t.get<AdminConfig>(XPortal::service, "/admin/config");
      REQUIRE(config.free_tier.tokens.has_value());
      auto cost    = t.from(alice).to<Invite>().getInvCost(1, *config.free_tier.tokens).returnVal();
      auto allowed = XPortal::creatorAllowed();
      allowed.push_back({Tokens::service, MethodNumber{"debit"}});
      createCreator(t, alice, agentPub, Quantity{billed.cost}, cost, allowed);
      REQUIRE(t.from(XPortal::creatorAccount)
                  .with(KeyList{{agentPub, agentPriv}})
                  .to<Tokens>()
                  .debit(billed.id, alice, cost, "")
                  .succeeded());
      configureX(t);
      t.put(XPortal::service, "/admin/config", RequestsSwitch{.requests_enabled = true});
      REQUIRE(t.get<Status>(XPortal::service, "/status").ready);
      return billed;
   }

   struct SandboxStripe
   {
      StripeKeys sandbox;
      PSIO_REFLECT(SandboxStripe, sandbox)
   };

   struct StripeCredentials
   {
      SandboxStripe stripe;
      PSIO_REFLECT(StripeCredentials, stripe)
   };

   const StripeKeys testStripe{.secret_key      = "sk_test_secret-wxyz",
                               .publishable_key = "pk_test_public",
                               .webhook_secret  = "whsec_test-5678"};

   void configureStripe(DefaultTestChain& t)
   {
      t.put(XPortal::service, "/admin/config",
            StripeCredentials{.stripe = {.sandbox = testStripe}});
   }

   // A paid signup for tier 0 that Stripe has not reported paid. Its id's
   // first byte is `inviteId`.
   Checksum256 storePendingSignup(uint8_t inviteId, std::string xId)
   {
      Checksum256 id{};
      id[0]    = inviteId;
      auto now = std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now());
      XPortal{}.open<SignupTable>().put(Signup{.id        = id,
                                               .invite_id = inviteId,
                                               .payload   = invitePayload(inviteId),
                                               .token     = "token-" + std::to_string(inviteId),
                                               .usd_cents = 500,
                                               .state     = "pending",
                                               .created   = now,
                                               .updated   = now,
                                               .x_id      = std::move(xId),
                                               .tier      = 0});
      return id;
   }

   std::int64_t unixNow()
   {
      return std::chrono::duration_cast<std::chrono::seconds>(
                 std::chrono::system_clock::now().time_since_epoch())
          .count();
   }

   std::string stripeSignature(std::string_view secret, std::string_view body)
   {
      auto        t = unixNow();
      std::string hex;
      for (auto byte : hmacSha256(secret, std::format("{}.{}", t, body)))
         hex += std::format("{:02x}", byte);
      return std::format("t={},v1={}", t, hex);
   }

   std::string paidCheckoutEvent(std::string_view signupId)
   {
      return std::format(
          R"({{"id":"evt_1","object":"event","type":"checkout.session.completed",)"
          R"("data":{{"object":{{"id":"cs_test_1","object":"checkout.session","amount_total":500,)"
          R"("customer":null,"payment_status":"paid","metadata":{{"signup_id":"{}"}}}}}}}})",
          signupId);
   }

   HttpReply postWebhook(DefaultTestChain& t, std::string_view body, std::string_view signature)
   {
      return t.http(HttpRequestBuilder{}
                        .header("Stripe-Signature", signature)
                        .post(XPortal::service, "/stripe/webhook",
                              RawBody{"application/json", std::string{body}}));
   }
}  // namespace

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
         "requests_enabled, x, stripe, or tiers is required\n");
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

   t.put(XPortal::service, "/admin/config",
         RequestsAndPrice{.requests_enabled = false, .price_per_token_usd_micros = 99});
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
   auto again = t.get<AdminConfig>(XPortal::service, "/admin/config");
   CHECK(again.price_per_token_usd_micros == config.price_per_token_usd_micros);
   CHECK(again.requests_enabled == false);

   status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, false, false);
   CHECK(status.ready == false);

   auto grant = config.free_tier.tokens->value;
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

   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[1].ok);
   CHECK(status.conditions[2].ok);
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
   CHECK(t.from(alice).to<Tokens>().getBalance(sys, XPortal::creatorAccount).returnVal().value == 0);
   CHECK(t.from(alice).to<Tokens>().getSharedBal(sys, alice, XPortal::creatorAccount).returnVal().value ==
         funded.value);
   auto sub =
       t.from(VirtualServer::service).to<Tokens>().getSubBal(sys, XPortal::creatorAccount.str()).returnVal();
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
   expect(t.pushTransaction(t.makeTransaction({scope.newAccount(
       creator, agentPub, alice, std::vector<AllowedAction>{{Tokens::service, MethodNumber{"debit"}}})})));
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
   auto pushed = runAs(t, XHttp::service, XPortal::service, "onPushReply",
                       std::tuple{std::int32_t{11},
                                  HttpReply{.status = HttpStatus::ok,
                                            .body   = psio::to_frac(TransactionTrace{})}});
   CHECK(!pushed.error.has_value());
   auto done = t.http<SignupView>(
       withSession(forwarded("GET", "/signup/" + created.signup_id), "owner"));
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
       std::tuple{std::int32_t{12},
                  HttpReply{.status = HttpStatus::ok,
                            .body = psio::to_frac(TransactionTrace{
                                .error = std::string{"invite id is taken"}})}});
   CHECK(!failedPush.error.has_value());
   auto hidden =
       t.http(withSession(forwarded("GET", "/signup/" + second.signup_id), "other"));
   CHECK(hidden.status == HttpStatus::ok);
   CHECK(replyText(hidden).find("invite id is taken") == std::string::npos);
   auto view = t.http<SignupView>(
       withSession(forwarded("GET", "/signup/" + second.signup_id), "other"));
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
   auto id = storePendingSignup(23, "42");
   auto path = "/admin/signups/" +
               toBase64Url({reinterpret_cast<const char*>(id.data()), id.size()}) + "/retry";
   auto retry = [&] {
      return t.http(HttpRequestBuilder{}.post(XPortal::service, path, EmptyBody{}));
   };
   CHECK(retry().status == HttpStatus::conflict);
   auto table = XPortal{}.open<SignupTable>();
   auto row = *table.get(id);
   row.state = "queued";
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
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_id":""}})") == "x.client_id must be a non-empty string\n");
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_secret":true}})") ==
         "x.client_secret must be a non-empty string\n");
   for (auto bad : {"api.x.com", "https://api.x.com/", "https://api.x.com/2", "https://"})
      CHECK(putConfigExpectBadRequest(t, std::format(R"({{"x":{{"api_base":"{}"}}}})", bad)) ==
            "x.api_base must be an http or https origin\n");
   CHECK(putConfigExpectBadRequest(t, R"({"x":{"client_id":"kept","api_base":"bad"}})").starts_with("x.api_base"));
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

   authorize = startXSignIn(t, {{"Host", "x-portal.psibase.io:9090"},
                                {"X-Forwarded-Proto", "https"}});
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
   auto stale   = startXSignIn(t);
   row          = XPortal{}.open<XAuthRequestTable>().get(stale.state);
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
   auto billed  = openBilledPortal(t);
   configureStripe(t);
   t.put(XPortal::service, "/admin/config",
         RawBody{"application/json", R"({"tiers":[{"label":"Paid","usd_cents":500}]})"});

   auto offers = t.get<TierOffers>(XPortal::service, "/tiers");
   REQUIRE(offers.free.has_value());
   REQUIRE(offers.tiers.size() == 1);
   auto paidTokens = offers.tiers[0].tokens;
   REQUIRE(paidTokens.value > offers.free->tokens.value);

   auto inviteCost = [&] {
      return t.from(alice).to<Invite>().getInvCost(1, paidTokens).returnVal();
   };
   auto creatorBalance = [&] {
      return t.from(alice).to<Tokens>().getBalance(billed.id, creator).returnVal();
   };
   REQUIRE(inviteCost().value > creatorBalance().value);

   auto status = t.get<Status>(XPortal::service, "/status");
   requireBillingReadiness(status, false, true);
   CHECK(status.ready == false);
   openSession("payer", "42");
   auto blocked = t.http(withSession(
       HttpRequestBuilder{}
           .header("X-Forwarded-For", "203.0.113.8")
           .post(XPortal::service, "/signup",
                 SignupBody{.invite_id = 7,
                            .payload   = invitePayload(7),
                            .token     = "token-7",
                            .tier      = 0}),
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
}
