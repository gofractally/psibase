#include <psibase/ForkDb.hpp>

namespace psibase
{

   BlockHeaderState::BlockHeaderState(SystemContext* systemContext, SnapshotLoader&& loader)
       : revision(loader.revision),
         producers(std::move(loader.validator->producers)),
         nextProducers(std::move(loader.validator->nextProducers)),
         nextProducersBlockNum(0)
   {
      if (loader.validator->state.next)
      {
         nextProducersBlockNum = loader.validator->state.next->blockNum;
      }
      Database db{systemContext->sharedDatabase, revision};
      auto     session = db.startRead();
      auto     status  = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key());
      check(status && status->head, "Invalid status row in snapshot");
      info = *status->head;
   }

}  // namespace psibase
