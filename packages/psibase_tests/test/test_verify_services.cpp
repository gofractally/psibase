#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

#include <services/system/SetCode.hpp>
#include <services/system/VerifySig.hpp>
#include <services/test/AbortService.hpp>
#include <services/test/RemoveCode.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;

namespace psibase
{
   std::ostream& operator<<(std::ostream& os, const BlockHeaderAuthAccount& a)
   {
      return os << psio::convert_to_json(a);
   }
}  // namespace psibase

namespace
{
   auto pubFromPem = [](std::string param) {  //
      return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)};
   };

   auto privFromPem = [](std::string param) {  //
      return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)};
   };

   auto aliceKeys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
                          "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
                           "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
                           "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
                           "-----END PRIVATE KEY-----\n")};

   std::vector<BlockHeaderAuthAccount> getActual(TestChain& t)
   {
      std::vector<BlockHeaderAuthAccount> result;
      std::vector<char>                   key       = psio::convert_to_key(codePrefix());
      auto                                prefixLen = key.size();
      while (auto row = t.kvGreaterEqualRaw(CodeRow::db, key, prefixLen))
      {
         auto a = psio::from_frac<CodeRow>(*row);
         if ((a.flags & CodeRow::isVerify) &&
             t.kvGet<CodeByHashRow>(CodeByHashRow::db,
                                    codeByHashKey(a.codeHash, a.vmType, a.vmVersion)))
            result.push_back({a.codeNum, a.codeHash, a.vmType, a.vmVersion});
         key = psio::convert_to_key(a.key());
         key.push_back(0);
      }
      return result;
   }

   std::vector<BlockHeaderAuthAccount> getReported(TestChain& t)
   {
      if (auto status = t.kvGet<StatusRow>(StatusRow::db, statusKey()))
      {
         if (status->consensus.next)
            return std::move(status->consensus.next->consensus.services);
         else
            return std::move(status->consensus.current.services);
      }
      return {};
   }
}  // namespace

TEST_CASE("Verify service tracking")
{
   DefaultTestChain t;
   t.addService(RemoveCode::service, "RemoveCode.wasm");
   REQUIRE(t.from(SetCode::service)
               .to<SetCode>()
               .setFlags(RemoveCode::service, RemoveCode::serviceFlags)
               .succeeded());
   t.addService(AbortService::service, "AbortService.wasm");

   auto removeCode = [&](AccountNumber account)
   {
      auto                   row = t.kvGet<CodeRow>(CodeRow::db, codeKey(account)).value();
      transactor<RemoveCode> removeCode{RemoveCode::service, RemoveCode::service};
      return removeCode.removeCode(row.codeHash, row.vmType, row.vmVersion);
   };
   auto setCodeRow = [&](CodeRow row)
   {
      transactor<RemoveCode> removeCode{RemoveCode::service, RemoveCode::service};
      return removeCode.setCodeRow(row);
   };

   auto setCode = [&](AccountNumber account, const char* filename = nullptr)
   {
      transactor<SetCode> setCode{account, SetCode::service};
      auto                code = filename ? readWholeFile(filename) : std::vector<char>{};
      return setCode.setCode(account, 0, 0, code);
   };
   auto setFlags = [&](AccountNumber account, std::uint64_t flags)
   {
      transactor<SetCode> setCode{SetCode::service, SetCode::service};
      return setCode.setFlags(account, flags);
   };
   auto passOrFail = [&](std::vector<Action> actions)
   {
      SECTION("succeed")
      {
         expect(t.pushTransaction(t.makeTransaction(std::move(actions))));
      }
      SECTION("fail")
      {
         transactor<AbortService> abort{AbortService::service, AbortService::service};
         std::string              message{"abort after setting flags"};
         actions.push_back(abort.abort(message));
         expect(t.pushTransaction(t.makeTransaction(std::move(actions))), message);
      }
   };

   constexpr auto verify2 = AccountNumber{"verify2"};

   t.setAutoBlockStart(false);
   t.startBlock();

   SECTION("Add new service")
   {
      t.addAccount(verify2);
      passOrFail({setCode(verify2, "VerifySig.wasm"), setFlags(verify2, VerifySig::serviceFlags)});
   }
   SECTION("Add new service after flag")
   {
      t.addAccount(verify2);
      REQUIRE(t.from(SetCode::service)
                  .to<SetCode>()
                  .setFlags(verify2, VerifySig::serviceFlags)
                  .succeeded());
      t.startBlock();
      passOrFail({setCode(verify2, "VerifySig.wasm")});
   }
   SECTION("Set flag without service")
   {
      t.addAccount(verify2);
      REQUIRE(t.from(SetCode::service)
                  .to<SetCode>()
                  .setFlags(verify2, VerifySig::serviceFlags)
                  .succeeded());
   }
   SECTION("Set flag for service")
   {
      passOrFail({setFlags(RemoveCode::service, CodeRow::isVerify)});
   }
   SECTION("Unset flag for service")
   {
      passOrFail({setFlags(VerifySig::service, 0)});
   }
   SECTION("Remove service")
   {
      passOrFail({setCode(VerifySig::service, nullptr)});
   }
   SECTION("Remove code")
   {
      passOrFail({removeCode(VerifySig::service)});
   }
   SECTION("Add without code")
   {
      passOrFail({setCodeRow({verify2, VerifySig::serviceFlags, sha256("", 0), 0, 0})});
   }
   SECTION("Add and...")
   {
      t.addService(verify2, "VerifySig.wasm", VerifySig::serviceFlags);
      SECTION("remove")
      {
         passOrFail({setCode(verify2, nullptr)});
      }
      SECTION("unset flag")
      {
         passOrFail({setFlags(verify2, 0)});
      }
      SECTION("remove code")
      {
         passOrFail({removeCode(verify2)});
      }
   }
   SECTION("Remove and...")
   {
      expect(t.pushTransaction(t.makeTransaction({setCode(VerifySig::service, nullptr)})));
      SECTION("add")
      {
         passOrFail({setCode(VerifySig::service, "VerifySig.wasm")});
      }
   }

   t.finishBlock();
   CHECK(getReported(t) == getActual(t));
}
