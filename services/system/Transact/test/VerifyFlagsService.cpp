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
   if (flags & CodeRow::allowSudo)
   {
      Actor<VerifyFlagsService> self{sudoAccount, getReceiver()};
      auto                      _ = recurse();
      self.sudo();
   }
   if (flags & CodeRow::allowWriteNative)
   {
      ConfigRow row{};
      kvPut(ConfigRow::db, row.key(), row);
   }
   if (flags & CodeRow::isSubjective)
   {
      if (flags & CodeRow::allowSocket)
      {
         Action act{
             .sender  = getReceiver(),
             .service = getReceiver(),
             .method  = MethodNumber{"recv"},
             .rawData = psio::to_frac(std::tuple()),
         };
         socketSend(SocketRow::producer_multicast, psio::to_frac(act));
      }
      else if (flags & CodeRow::allowNativeSubjective)
      {
         PSIBASE_SUBJECTIVE_TX
         {
            auto row = kvGetRaw(DbId::nativeSubjective,
                                psio::convert_to_key(notifyKey(NotifyType::nextTransaction)));
         }
      }
      else
      {
         auto row = kvGetRaw(DbId::writeOnly, psio::convert_to_key(getReceiver()));
         check(!row, "writeOnly row was set");
      }
   }
   if (flags & CodeRow::allowWriteSubjective)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         kvPutRaw(DbId::subjective, psio::convert_to_key(getReceiver()), std::vector<char>());
      }
   }
   if (flags & CodeRow::canNotTimeOut)
   {
      // TODO: Is testing this even possible?
   }
   if (flags & CodeRow::canSetTimeLimit)
   {
      raw::setMaxTransactionTime(0x100000000u);
   }
   if (flags & CodeRow::isAuthService)
   {
      // This had better be true
   }
   if (flags & CodeRow::forceReplay)
   {
      // Depends on isSubjective
   }
}

PSIBASE_DISPATCH(VerifyFlagsService)
