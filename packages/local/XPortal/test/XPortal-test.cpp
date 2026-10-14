#include <services/local/XPortal.hpp>

#include <format>
#include <limits>
#include <tuple>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/fileUtil.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XKeys.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/user/Tokens.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace SystemService::AuthSig;
using namespace UserService;

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

   void installPortal(DefaultTestChain& t)
   {
      t.put(XAdmin::service, "/services/" + XPortal::service.str() + "?isPrivileged=1",
            WasmFileBody{"XPortal.wasm"});
      t.post(XHttp::service, "/register_server",
             JsonBody{RegisteredServiceRow{XPortal::service, XPortal::service}});
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

   std::vector<AllowedAction> creatorAllowed()
   {
      return {
          {AccountNumber{"auth-sig"}, MethodNumber{"newAccount"}},
          {Tokens::service, MethodNumber{"credit"}},
          {Tokens::service, MethodNumber{"debit"}},
          {Tokens::service, MethodNumber{"setUserConf"}},
          {VirtualServer::service, MethodNumber{"buy_res_for"}},
      };
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

   void createCreator(DefaultTestChain&              t,
                      AccountNumber                  producer,
                      const SubjectPublicKeyInfo&    pub,
                      const std::optional<Quantity>& buffer = {},
                      const std::optional<Quantity>& grant  = {})
   {
      transactor<AuthScope>     scope{producer, AuthScope::service};
      transactor<Tokens>        tokens{producer, Tokens::service};
      transactor<VirtualServer> vserver{producer, VirtualServer::service};
      std::vector<Action>       actions{
          scope.newAccount(XPortal::creatorAccount, pub, producer, creatorAllowed())};
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
}  // namespace

TEST_CASE("status, requests switch, and seeded pricing")
{
   DefaultTestChain t{{"TestDefault", "TokenUsers", "AuthScope"}};
   installPortal(t);
   auto alice   = AccountNumber{"alice"};
   auto creator = XPortal::creatorAccount;

   auto status = t.http<Status>(forwarded("GET", "/status"));
   CHECK(status.requests_enabled == false);
   CHECK(status.billing_enabled == false);
   CHECK(status.ready == false);
   REQUIRE(status.conditions.size() == 1);
   CHECK(status.conditions[0].id == "creator_ready");
   CHECK(status.conditions[0].ok == false);

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
   CHECK(std::string(missing.body.begin(), missing.body.end()) == "requests_enabled is required\n");
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

   std::vector<AllowedAction> allowed{{Tokens::service, MethodNumber{"debit"}}};
   REQUIRE(t.from(alice).to<AuthScope>().newAccount(creator, agentPub, alice, allowed).succeeded());
   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[0].ok == false);

   XPortal{}.open<AgentKeyTable>().put(
       AgentKey{.name = std::string{XPortal::creatorAgent}, .pubkey = agentPub});
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
   CHECK(status.billing_enabled);
   REQUIRE(status.conditions.size() == 2);
   CHECK(status.conditions[0].id == "creator_ready");
   CHECK(status.conditions[0].ok);
   CHECK(status.conditions[1].id == "creator_funded");
   CHECK(status.conditions[1].ok == false);
   CHECK(status.ready == false);

   auto grant = config.free_tier.tokens->value;
   REQUIRE(grant > 0);
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, VirtualServer::service, cost, "").succeeded());
   REQUIRE(t.from(alice).to<VirtualServer>().buy_res_for(cost, creator, "").succeeded());
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, creator, grant, "").succeeded());
   REQUIRE(t.from(creator)
               .with(KeyList{{agentPub, agentPriv}})
               .to<Tokens>()
               .debit(sys, alice, grant, "")
               .succeeded());

   status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.conditions[1].ok);
   CHECK(status.ready);
}

TEST_CASE("producer funds ac-creator when billing is enabled")
{
   DefaultTestChain t{{"TestDefault", "TokenUsers", "AuthScope"}};
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
   CHECK(row->allowed == creatorAllowed());

   auto status = t.get<Status>(XPortal::service, "/status");
   CHECK(status.billing_enabled);
   REQUIRE(status.conditions.size() == 2);
   CHECK(status.conditions[0].id == "creator_ready");
   CHECK(status.conditions[0].ok);
   CHECK(status.conditions[1].id == "creator_funded");
   CHECK(status.conditions[1].ok == false);
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
