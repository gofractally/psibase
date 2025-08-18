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
      kvPutRaw(DbId::writeOnly, psio::convert_to_key(getReceiver()), std::vector<char>{});
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
         Action act{
             .sender  = getReceiver(),
             .service = getReceiver(),
             .method  = MethodNumber{"recv"},
             .rawData = psio::to_frac(std::tuple()),
         };
         socketSend(SocketRow::producer_multicast, psio::to_frac(act));
      }
      else
      {
         auto row = kvGetRaw(DbId::writeOnly, psio::convert_to_key(getReceiver()));
         check(!row, "writeOnly row was set");
      }
   }
   else if (flags & CodeRow::isPrivileged)
   {
      ConfigRow row{};
      kvPut(ConfigRow::db, row.key(), row);
   }
}

PSIBASE_DISPATCH(VerifyFlagsService)
