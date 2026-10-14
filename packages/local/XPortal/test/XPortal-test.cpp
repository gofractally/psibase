#include <services/local/XPortal.hpp>

#include <format>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/fileUtil.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/PrivateKeyInfo.hpp>
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
      return builder.request(XPortal::service, method, target);
   }

   void setProducer(DefaultTestChain& t, std::string_view name)
   {
      auto row = t.kvGet<HostConfigRow>(HostConfigRow::db, hostConfigKey());
      REQUIRE(row.has_value());
      row->config = std::format(R"({{"host":{{"hosts":["psibase.io"],"producer":"{}"}}}})", name);
      t.kvPut(HostConfigRow::db, row->key(), *row);
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

   REQUIRE(t.to<VirtualServer>().init_billing(Tokens::service).succeeded());
   auto sysToken = t.from(alice).to<Tokens>().getSysToken().returnVal();
   auto sys      = sysToken->id;
   auto scale    = uint64_t{1};
   for (uint8_t i = 0; i < sysToken->precision.value; ++i)
      scale *= 10;
   auto cost = t.to<VirtualServer>().std_buffer_cost().returnVal().value;
   REQUIRE(cost != 0);
   REQUIRE(t.from(alice)
               .to<Tokens>()
               .debit(sys, AccountNumber{"faucet-tok"}, 100'000'0000, "")
               .succeeded());
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, VirtualServer::service, cost, "").succeeded());
   REQUIRE(
       t.from(alice).to<VirtualServer>().buy_res_for(cost, VirtualServer::service, "").succeeded());
   REQUIRE(t.from(alice).to<Tokens>().credit(sys, VirtualServer::service, cost, "").succeeded());
   REQUIRE(t.from(alice).to<VirtualServer>().buy_res(cost).succeeded());
   REQUIRE(t.to<VirtualServer>().enable_billing().succeeded());

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
