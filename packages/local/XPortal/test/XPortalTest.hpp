#pragma once

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

   struct StripeModeBody
   {
      std::string mode;
      PSIO_REFLECT(StripeModeBody, mode)
   };

   struct BothStripeCredentials
   {
      StripeConfig stripe;
      PSIO_REFLECT(BothStripeCredentials, stripe)
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
      REQUIRE(t.from(payer)
                  .to<Tokens>()
                  .credit(sysToken->id, VirtualServer::service, resource, "")
                  .succeeded());
      REQUIRE(t.from(payer)
                  .to<VirtualServer>()
                  .buy_res_for(resource, VirtualServer::service, "")
                  .succeeded());
      REQUIRE(t.from(payer)
                  .to<Tokens>()
                  .credit(sysToken->id, VirtualServer::service, resource, "")
                  .succeeded());
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
                                          .payload = invitePayload(static_cast<uint8_t>(inviteId)),
                                          .token   = "token-" + std::to_string(inviteId)});
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
      XKeys{}.open<KeyTable>().put(KeyRow{.id = sha256(agentPub.data.data(), agentPub.data.size()),
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

   AuthorizeQuery startXSignIn(DefaultTestChain& t, std::vector<HttpHeader> extraHeaders = {})
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
   TransactionTrace runAs(DefaultTestChain& t,
                          AccountNumber     sender,
                          AccountNumber     service,
                          std::string_view  method,
                          const T&          args)
   {
      return tester::runAction(t.nativeHandle(), RunMode::rpc, false,
                               Action{.sender  = sender,
                                      .service = service,
                                      .method  = MethodNumber{method},
                                      .rawData = psio::convert_to_frac(args)});
   }

   void configureStripe(DefaultTestChain& t);

   Quantity largestTierTokens(DefaultTestChain& t)
   {
      auto                    offers = t.get<TierOffers>(XPortal::service, "/tiers");
      std::optional<Quantity> largest;
      if (offers.free)
         largest = offers.free->tokens;
      for (const auto& tier : offers.tiers)
         if (!largest || tier.tokens.value > largest->value)
            largest = tier.tokens;
      REQUIRE(largest.has_value());
      return *largest;
   }

   // Billing on, ac-creator funded for the largest tier, X and Stripe
   // configured, and requests open. ac-creator may also debit, which claims
   // its grant here instead of the plugin's auto-debit.
   BilledToken openBilledPortal(DefaultTestChain& t)
   {
      auto alice = AccountNumber{"alice"};
      setProducer(t, "alice");
      storeCreatorKey();
      auto billed = enableBilling(t, alice, 5);

      auto grant   = largestTierTokens(t);
      auto cost    = t.from(alice).to<Invite>().getInvQuote(1, grant).returnVal();
      auto allowed = XPortal::creatorAllowed();
      allowed.push_back({Tokens::service, MethodNumber{"debit"}});
      createCreator(t, alice, agentPub, Quantity{billed.cost}, cost, allowed);
      REQUIRE(t.from(XPortal::creatorAccount)
                  .with(KeyList{{agentPub, agentPriv}})
                  .to<Tokens>()
                  .debit(billed.id, alice, cost, "")
                  .succeeded());
      configureX(t);
      configureStripe(t);
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

   const StripeKeys testProduction{.secret_key      = "sk_live_secret-wxyz",
                                   .publishable_key = "pk_live_public",
                                   .webhook_secret  = "whsec_live-5678"};

   void configureStripe(DefaultTestChain& t)
   {
      t.put(XPortal::service, "/admin/config",
            StripeCredentials{.stripe = {.sandbox = testStripe}});
   }

   // A paid signup for tier 0 that Stripe has not reported paid. Its id's
   // first byte is `inviteId`.
   std::string signupIdText(const Checksum256& id)
   {
      return toBase64Url({reinterpret_cast<const char*>(id.data()), id.size()});
   }

   Checksum256 storePendingSignup(uint8_t inviteId, std::string xId, std::string mode = "sandbox")
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
                                               .tier      = 0,
                                               .mode      = std::move(mode)});
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

   std::string paidCheckoutEvent(std::string_view signupId, std::string_view eventId = "evt_1")
   {
      return std::format(
          R"({{"id":"{}","object":"event","type":"checkout.session.completed",)"
          R"("data":{{"object":{{"id":"cs_test_1","object":"checkout.session","amount_total":500,)"
          R"("customer":null,"payment_status":"paid","metadata":{{"signup_id":"{}"}}}}}}}})",
          eventId, signupId);
   }

   HttpReply postWebhook(DefaultTestChain& t, std::string_view body, std::string_view signature)
   {
      return t.http(HttpRequestBuilder{}
                        .header("Stripe-Signature", signature)
                        .post(XPortal::service, "/stripe/webhook",
                              RawBody{"application/json", std::string{body}}));
   }
}  // namespace
