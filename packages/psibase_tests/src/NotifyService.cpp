#include <services/test/NotifyService.hpp>

#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace TestService;

void NotifyService::onBlock()
{
   auto count = WriteOnly{getReceiver()}.open<BlockCountTable>();
   auto row   = count.get({}).value_or(BlockCountRow{});
   ++row.count;
   count.put(row);

   PSIBASE_SUBJECTIVE_TX
   {
      if (Subjective{getReceiver(), KvMode::read}.open<FailTable>().get({}))
      {
         abortMessage("as you wish");
      }
   }
}

void NotifyService::onTrx(const psibase::Checksum256& /*id*/,
                          psio::view<const psibase::TransactionTrace> /*trace*/)
{
   auto count = WriteOnly{getReceiver()}.open<TransactionCountTable>();
   auto row   = count.get({}).value_or(TransactionCountRow{});
   ++row.count;
   count.put(row);

   PSIBASE_SUBJECTIVE_TX
   {
      if (Subjective{getReceiver(), KvMode::read}.open<FailTable>().get({}))
      {
         abortMessage("as you wish");
      }
   }
}

PSIBASE_DISPATCH(NotifyService)
