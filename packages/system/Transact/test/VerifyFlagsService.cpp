#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <vector>

using namespace psibase;

struct VerifyFlagsService : Service
{
   static constexpr auto sudoAccount = AccountNumber{"other"};
   void verifySys(Checksum256 transactionHash, Claim claim, std::vector<char> proof);
   void sudo() { check(getSender() == sudoAccount, "wrong sender"); }
   void setRow()
   {
      auto handle = kvOpen(DbId::writeOnly, psio::convert_to_key(getReceiver()), KvMode::write);
      kvPutRaw(handle, {}, std::vector<char>{});
      kvClose(handle);
   }
   void recv() {}
};
PSIO_REFLECT(VerifyFlagsService,
             method(verifySys, transactionHash, claim, proof),
             method(sudo),
             method(setRow),
             method(recv))

void VerifyFlagsService::verifySys(Checksum256       transactionHash,
                                   Claim             claim,
                                   std::vector<char> proof)
{
   auto flags = psio::from_frac<std::uint64_t>(proof);
   if (flags & CodeRow::runMode)
   {
      if (flags & CodeRow::isPrivileged)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto handle =
                kvOpen(DbId::subjective, psio::convert_to_key(getReceiver()), KvMode::write);
            kvClose(handle);
         }
      }
      else
      {
         auto handle = kvOpen(DbId::writeOnly, psio::convert_to_key(getReceiver()), KvMode::read);
         auto row    = kvGetRaw(handle, {});
         check(!row, "writeOnly row was set");
         kvClose(handle);
      }
   }
   else if (flags & CodeRow::isPrivileged)
   {
      Native::tables().open<ConfigTable>().put({});
   }
}

PSIBASE_DISPATCH(VerifyFlagsService)
