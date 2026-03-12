#include <psibase/db.hpp>

std::string psibase::to_string(DbId db)
{
   switch (db)
   {
      case DbId::service:
         return "service";
      case DbId::writeOnly:
         return "writeOnly";
      case DbId::native:
         return "native";
      case DbId::blockLog:
         return "blockLog";
      case DbId::historyEvent:
         return "historyEvent";
      case DbId::uiEvent:
         return "uiEvent";
      case DbId::merkleEvent:
         return "merkleEvent";
      case DbId::blockProof:
         return "blockProof";
      case DbId::subjective:
         return "subjective";
      case DbId::nativeSubjective:
         return "nativeSubjective";
      case DbId::session:
         return "session";
      case DbId::nativeSession:
         return "nativeSession";
      case DbId::temporary:
         return "temporary";
      default:
         return std::to_string(static_cast<std::uint32_t>(db));
   }
}
