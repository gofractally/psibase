#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/user/Nop.hpp>

using namespace psibase;
using namespace SystemService;

namespace
{
   auto pubFromPem = [](std::string_view param)
   { return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)}; };

   auto privFromPem = [](std::string_view param)
   { return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)}; };

   auto agentKeys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
                          "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
                           "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
                           "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
                           "-----END PRIVATE KEY-----\n")};
   auto otherPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
       "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
       "-----END PUBLIC KEY-----\n");
}  // namespace

TEST_CASE("auth-scope")
{
   DefaultTestChain t;
   t.addService<AuthScope>("AuthScope.wasm");

   auto                       owner = t.from(t.addAccount("alice"_a));
   auto                       other = t.from(t.addAccount("bob"_a));
   auto                       agent = "agentacct"_a;
   std::vector<AllowedAction> allowed{{UserService::Nop::service, "nop"_m}};

   auto pushAsAgent = [&](Action action)
   {
      return TraceResult(
          t.pushTransaction(t.makeTransaction({std::move(action)}), KeyList{agentKeys}));
   };

   // 1. an AuthScope can be created
   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentKeys.first, owner, allowed, NewAccountMode::requireNew)
               .succeeded());
   auto row = owner.to<AuthScope>().get(agent).returnVal();
   REQUIRE(row.has_value());
   CHECK(row->account == agent);
   CHECK(row->owner == owner.id);
   CHECK(row->allowed == allowed);
   auto account = owner.to<Accounts>().getAccount(agent).returnVal();
   REQUIRE(account.has_value());
   CHECK(account->authService == AuthScope::service);

   // 2. only updated by its owner
   CHECK(other.to<AuthScope>().setKey(agent, otherPub).failed("sender is not the owner"));
   CHECK(other.to<AuthScope>().setAllowed(agent, allowed).failed("sender is not the owner"));

   // 3. authorized vs unauthorized actions
   CHECK(pushAsAgent(Action{.sender = agent, .service = UserService::Nop::service, .method = "nop"_m})
             .succeeded());
   CHECK(pushAsAgent(Action{.sender  = agent,
                            .service = UserService::Nop::service,
                            .method  = "withId"_m,
                            .rawData = psio::to_frac(std::tuple(1u))})
             .failed("Authorization for agentacct -> nop::withid failed"));
   CHECK(pushAsAgent(Action{.sender = agent, .service = AuthScope::service, .method = "setKey"_m})
             .failed("Authorization for agentacct -> auth-scope::setkey failed"));
}
