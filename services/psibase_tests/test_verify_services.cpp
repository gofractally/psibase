#include <psibase/DefaultTestChain.hpp>

#include <services/system/SetCode.hpp>
#include <services/system/VerifySig.hpp>

using namespace psibase;
using namespace SystemService;

namespace psibase
{
   std::ostream& operator<<(std::ostream& os, const BlockHeaderAuthAccount& a)
   {
      return os << psio::convert_to_json(a);
   }
}  // namespace psibase

namespace
{
   std::vector<BlockHeaderAuthAccount> getActual(TestChain& t)
   {
      std::vector<BlockHeaderAuthAccount> result;
      std::vector<char>                   key       = psio::convert_to_key(codePrefix());
      auto                                prefixLen = key.size();
      while (auto row = t.kvGreaterEqualRaw(CodeRow::db, key, prefixLen))
      {
         auto a = psio::from_frac<CodeRow>(*row);
         if ((a.flags & CodeRow::isAuthService) &&
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

   SECTION("Add new service")
   {
      auto verify2 = t.addService("verify2", "VerifySig.wasm");
      REQUIRE(t.from(SetCode::service)
                  .to<SetCode>()
                  .setFlags(verify2, VerifySig::serviceFlags)
                  .succeeded());
   }
   SECTION("Unset flag for service")
   {
      REQUIRE(t.from(SetCode::service).to<SetCode>().setFlags(VerifySig::service, 0).succeeded());
   }
   SECTION("Remove service")
   {
      REQUIRE(t.from(VerifySig::service)
                  .to<SetCode>()
                  .setCode(VerifySig::service, 0, 0, std::vector<char>())
                  .succeeded());
   }

   t.finishBlock();
   CHECK(getReported(t) == getActual(t));

   // add new verify service
   // remove existing verify service
   // set flags for verify service
   // remove verify service flags
   // add without code
   // remove code
   // add and remove
   // remove and add
   // failed transactions
}
