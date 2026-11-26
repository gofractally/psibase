#include <services/local/XDb.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>

using namespace psibase;
using namespace LocalService;

namespace
{
   bool isRead(KvMode mode)
   {
      return mode == KvMode::read || mode == KvMode::readWrite;
   }
   bool isWrite(KvMode mode)
   {
      return mode == KvMode::write || mode == KvMode::readWrite;
   }

   // These are lookups made whenever a service opens a node-local table.
   // A read needs no section: outside one it is a read of what was
   // published last and takes no lock (gofractally/psibase#2276).
   bool isLocal(AccountNumber sender)
   {
      return Native::subjectiveDirect(KvMode::read).open<CodeTable>().get(sender).has_value();
   }

   bool isLocalPrivileged(AccountNumber sender)
   {
      auto row = Native::subjectiveDirect(KvMode::read).open<CodeTable>().get(sender);
      return row && (row->flags & CodeRow::isPrivileged);
   }
   bool isPrivileged(AccountNumber sender)
   {
      auto row = Native::tablesDirect(KvMode::read).open<CodeTable>().get(sender);
      return row && (row->flags & CodeRow::isPrivileged);
   }

}  // namespace

UniqueKvHandle XDb::open(DbId db, psio::pssz_view<std::vector<char>> prefixView, KvMode mode)
{
   auto prefix        = std::span<const char>(prefixView);
   auto sender        = getSender();
   auto requirePrefix = [&]
   {
      auto expected = psio::to_key(sender);
      if (!std::ranges::starts_with(prefix, expected))
      {
         abortMessage("key prefix must match service");
      }
   };
   if (db == DbId::subjective || db == DbId::session || db == DbId::temporary)
   {
      requirePrefix();
      if (isWrite(mode) && !isLocal(sender) && !isPrivileged(sender))
      {
         abortMessage("Service cannot write this db");
      }
   }
   else if (db == DbId::nativeSubjective || db == DbId::nativeSession)
   {
      if (!isLocalPrivileged(sender))
      {
         abortMessage("Service cannot access this db");
      }
   }
   else if (db == DbId::native)
   {
      if (isWrite(mode))
      {
         abortMessage("Service cannot write this db");
      }
   }
   else
   {
      abortMessage("Service cannot open this db");
   }

   return UniqueKvHandle{psibase::kvOpen(db, prefix, mode)};
}

PSIBASE_DISPATCH(XDb)
