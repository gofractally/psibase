#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/serviceEntry.hpp>
#include <services/system/Producers.hpp>
#include <services/system/Transact.hpp>

namespace TestService
{

   // A bare bones implementation of transact that
   // is used to test the consensus algorithm.
   struct MockTransact : psibase::Service
   {
      static constexpr auto service = SystemService::Transact::service;
      void                  startBlock();
      /// Called by native code on objective writes to the database
      void kvNotify(psibase::AccountNumber service,
                    psibase::DbId          db,
                    std::uint32_t          keyLen,
                    std::uint32_t          oldValueLen,
                    std::uint32_t          newValueLen);
      void setConsensus(psibase::ConsensusData consensus);
   };
   PSIO_REFLECT(MockTransact,
                method(startBlock),
                method(kvNotify, service, db, keyLen, oldValueLen, newValueLen))

}  // namespace TestService

using namespace TestService;
using namespace SystemService;
using namespace psibase;

void MockTransact::startBlock() {}

void MockTransact::kvNotify(psibase::AccountNumber service,
                            psibase::DbId          db,
                            std::uint32_t          keyLen,
                            std::uint32_t          oldValueLen,
                            std::uint32_t          newValueLen)
{
}

void MockTransact::setConsensus(ConsensusData consensus)
{
   auto table  = Native::tablesDirect().open<StatusTable>();
   auto status = table.get({});
   check(status.has_value(), "Missing status row");
   check(!status->consensus.next || status->consensus.next->blockNum == status->current.blockNum,
         "Consensus update pending");
   status->consensus.next = {{std::move(consensus), status->consensus.current.services,
                              status->consensus.current.wasmConfig},
                             status->current.blockNum};
   table.put(*status);
}

extern "C" [[clang::export_name("processTransaction")]] void processTransaction()
{
   auto top_act                = getCurrentActionView();
   auto args                   = psio::view<const ProcessTransactionArgs>(top_act->rawData());
   psibase::internal::receiver = Transact::service;

   for (auto act : args.transaction()->actions())
   {
      check(act.service() == Producers::service, "wrong service");
      check(act.method() == MethodNumber{"setConsensus"}, "wrong method");
      auto [consensus] = psio::from_frac<std::tuple<ConsensusData>>(act.rawData());
      MockTransact{}.setConsensus(std::move(consensus));
   }
}

extern "C" [[clang::export_name("nextTransaction")]] void nextTransaction()
{
   setRetval(std::optional<std::uint32_t>());
}

PSIBASE_DISPATCH(MockTransact)
