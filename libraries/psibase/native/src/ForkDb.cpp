#include <psibase/ForkDb.hpp>

namespace psibase
{

   BlockHeaderState::BlockHeaderState(SystemContext* systemContext, SnapshotLoader&& loader)
       : revision(loader.revision),
         producers(std::move(loader.producers)),
         nextProducers(std::move(loader.nextProducers)),
         nextProducersBlockNum(loader.nextProducersBlockNum)
   {
      Database db{systemContext->sharedDatabase, revision};
      auto     session = db.startRead();
      auto     status  = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key());
      check(status && status->head, "Invalid status row in snapshot");
      info = *status->head;
   }

}  // namespace psibase
