#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>
#include <services/user/Nop.hpp>

using namespace psibase;
using namespace SystemService;

namespace
{
   auto pubFromPem = [](std::string param)
   { return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)}; };

   auto privFromPem = [](std::string param)
   { return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)}; };

   auto agentPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto agentPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
       "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
       "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
       "-----END PRIVATE KEY-----\n");
   auto otherPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
       "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto otherPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEbcmTuUFGjyAn0zd\n"
       "7VKhIDZpswsI3m/5bMV+XoBQNTGhRANCAAQzeyU+Sa3KSwreirHYVfyB0jNMaNWt\n"
       "GjyjVxTbjHHHyq96f3lqGlbApIe9u1CUDng/qlj0jGbuz5sOeeIY/DWJ\n"
       "-----END PRIVATE KEY-----\n");

   Claim claimFor(const AuthSig::SubjectPublicKeyInfo& key)
   {
      return Claim{.service = VerifySig::service, .rawData = {key.data.begin(), key.data.end()}};
   }
}  // namespace

TEST_CASE("auth-scope newAccount and whitelist")
{
   DefaultTestChain t;
   t.addService<AuthScope>("AuthScope.wasm");

   auto                       owner = t.from(t.addAccount("alice"_a));
   auto                       agent = "agentacct"_a;
   auto                       nop   = ServiceMethod{UserService::Nop::service, "nop"_m};
   std::vector<AllowedAction> allowed{{UserService::Nop::service, "nop"_m},
                                      {AuthScope::service, "setAllowed"_m}};

   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentPub, "missing1"_a, allowed, NewAccountMode::requireNew)
               .failed("owner account does not exist"));

   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentPub, owner, allowed, NewAccountMode::requireNew)
               .returnVal());
   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentPub, owner, allowed, NewAccountMode::requireNew)
               .failed("account already exists"));

   auto row = owner.to<AuthScope>().get(agent).returnVal();
   REQUIRE(row.has_value());
   CHECK(row->account == agent);
   CHECK(row->pubkey == agentPub);
   CHECK(row->owner == owner.id);
   CHECK(row->allowed == allowed);

   auto account = owner.to<Accounts>().getAccount(agent).returnVal();
   REQUIRE(account.has_value());
   CHECK(account->authService == AuthScope::service);

   auto agentClaim  = claimFor(agentPub);
   auto otherClaim  = claimFor(otherPub);
   auto agentClaims = std::vector<Claim>{agentClaim};
   auto otherClaims = std::vector<Claim>{otherClaim};
   auto bothClaims  = std::vector<Claim>{otherClaim, agentClaim};
   auto noClaims    = std::vector<Claim>{};

   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, agentClaims).returnVal());
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, noClaims).returnVal() == false);
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, otherClaims).returnVal() == false);
   CHECK(owner.to<AuthScope>()
             .checkAuthSys(0, agent, ServiceMethod{UserService::Nop::service, "withId"_m},
                           agentClaims)
             .returnVal() == false);
   CHECK(owner.to<AuthScope>()
             .checkAuthSys(0, agent, ServiceMethod{Accounts::service, "exists"_m}, agentClaims)
             .returnVal() == false);
   CHECK(owner.to<AuthScope>()
             .checkAuthSys(0, agent, ServiceMethod{AuthScope::service, "setAllowed"_m}, agentClaims)
             .returnVal());
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, bothClaims).returnVal());
   CHECK(owner.to<AuthScope>()
             .checkAuthSys(0, "noonehas"_a, nop, agentClaims)
             .failed("sender is not configured in AuthScope"));

   REQUIRE(owner.to<AuthScope>().canAuthUserSys(agent).succeeded());
   CHECK(owner.to<AuthScope>()
             .canAuthUserSys("noonehas"_a)
             .failed("account is not configured in AuthScope"));
   auto owners = std::vector<AccountNumber>{owner};
   CHECK(owner.to<AuthScope>().getDlgsSys(agent, std::nullopt).returnVal() == owners);
   CHECK(owner.to<AuthScope>()
             .getDlgsSys("noonehas"_a, nop)
             .failed("sender is not configured in AuthScope"));
   CHECK(owner.to<AuthScope>().isAuthSys(agent, owners, nop).returnVal());
   CHECK(owner.to<AuthScope>().isRejectSys(agent, owners, std::nullopt).returnVal());

   auto agents = std::vector<AccountNumber>{agent};
   CHECK(owner.to<AuthScope>().isAuthSys(agent, agents, nop).returnVal());

   auto nopAct = Action{.sender = agent, .service = UserService::Nop::service, .method = "nop"_m};
   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({nopAct}), {{agentPub, agentPriv}}))
             .succeeded());
   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({nopAct}), {{otherPub, otherPriv}}))
             .failed("Authorization for agentacct -> nop::nop failed"));
   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({nopAct}),
                                       {{otherPub, otherPriv}, {agentPub, agentPriv}}))
             .succeeded());
   CHECK(TraceResult(t.pushTransaction(
                         t.makeTransaction({Action{.sender  = agent,
                                                   .service = UserService::Nop::service,
                                                   .method  = "withId"_m,
                                                   .rawData = psio::to_frac(std::tuple(1u))}}),
                         {{agentPub, agentPriv}}))
             .failed("Authorization for agentacct -> nop::withid failed"));
   CHECK(TraceResult(t.pushTransaction(t.makeTransaction({Action{
                                           .sender  = agent,
                                           .service = AuthScope::service,
                                           .method  = "setKey"_m,
                                       }}),
                                       {{agentPub, agentPriv}}))
             .failed("Authorization for agentacct -> auth-scope::setkey failed"));

   auto runAsNop = transactor<UserService::Nop>(agent, UserService::Nop::service).nop();
   CHECK(owner.to<Transact>()
             .runAs(std::move(runAsNop), std::vector<ServiceMethod>{})
             .succeeded());
}

TEST_CASE("auth-scope setKey and setAllowed")
{
   DefaultTestChain t;
   t.addService<AuthScope>("AuthScope.wasm");

   auto                       owner = t.from(t.addAccount("alice"_a));
   auto                       other = t.from(t.addAccount("bob"_a));
   auto                       agent = "agentacct"_a;
   auto                       nop   = ServiceMethod{UserService::Nop::service, "nop"_m};
   std::vector<AllowedAction> allowed{{UserService::Nop::service, "nop"_m}};

   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentPub, owner, allowed, NewAccountMode::requireNew)
               .succeeded());

   CHECK(other.to<AuthScope>()
             .setKey(agent, otherPub)
             .failed("sender is not the owner"));
   CHECK(other.to<AuthScope>()
             .setAllowed(agent, allowed)
             .failed("sender is not the owner"));
   CHECK(owner.to<AuthScope>()
             .setKey("noonehas"_a, otherPub)
             .failed("account is not configured in AuthScope"));

   REQUIRE(owner.to<AuthScope>().setKey(agent, otherPub).succeeded());
   auto row = owner.to<AuthScope>().get(agent).returnVal();
   REQUIRE(row.has_value());
   CHECK(row->pubkey == otherPub);

   auto otherClaim = claimFor(otherPub);
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, std::vector{otherClaim}).returnVal());
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, std::vector{claimFor(agentPub)}).returnVal() ==
         false);

   std::vector<AllowedAction> updated{{UserService::Nop::service, "withId"_m}};
   REQUIRE(owner.to<AuthScope>().setAllowed(agent, updated).succeeded());
   row = owner.to<AuthScope>().get(agent).returnVal();
   REQUIRE(row.has_value());
   CHECK(row->allowed == updated);
   CHECK(owner.to<AuthScope>().checkAuthSys(0, agent, nop, std::vector{otherClaim}).returnVal() == false);

   SECTION("setOwner")
   {
      CHECK(owner.to<AuthScope>()
                .setOwner(agent, "missing1"_a)
                .failed("owner account does not exist"));
      CHECK(owner.to<AuthScope>().setOwner(agent, agent).failed("circular ownership"));

      REQUIRE(owner.to<AuthScope>()
                  .newAccount("subagent"_a, otherPub, agent, allowed, NewAccountMode::requireNew)
                  .succeeded());
      CHECK(owner.to<AuthScope>().setOwner(agent, "subagent"_a).failed("circular ownership"));

      REQUIRE(owner.to<AuthScope>().setOwner(agent, other).succeeded());
      row = owner.to<AuthScope>().get(agent).returnVal();
      REQUIRE(row.has_value());
      CHECK(row->owner == other);

      CHECK(other.to<AuthScope>().setKey(agent, otherPub).succeeded());
      CHECK(owner.to<AuthScope>().setKey(agent, agentPub).failed("sender is not the owner"));
   }
}

TEST_CASE("auth-scope newAccount keepExisting requires the owner")
{
   DefaultTestChain t;
   t.addService<AuthScope>("AuthScope.wasm");

   auto                       owner = t.from(t.addAccount("alice"_a));
   auto                       other = t.from(t.addAccount("bob"_a));
   auto                       agent = "agentacct"_a;
   std::vector<AllowedAction> allowed{{UserService::Nop::service, "nop"_m}};

   REQUIRE(owner.to<AuthScope>()
               .newAccount(agent, agentPub, owner, allowed, NewAccountMode::requireNew)
               .succeeded());
   CHECK(other.to<AuthScope>()
             .newAccount(agent, otherPub, other, allowed, NewAccountMode::keepExisting)
             .failed("sender is not the owner"));
}
