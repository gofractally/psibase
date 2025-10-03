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

   bool isLocal(AccountNumber sender)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         return Native::subjectiveDirect(KvMode::read).open<CodeTable>().get(sender).has_value();
      }
      __builtin_unreachable();
   }

   bool isLocalPrivileged(AccountNumber sender)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = Native::subjectiveDirect(KvMode::read).open<CodeTable>().get(sender);
         return row && (row->flags & CodeRow::isPrivileged);
      }
      __builtin_unreachable();
   }

   bool isPrivileged(AccountNumber sender)
   {
      auto row = Native::tablesDirect(KvMode::read).open<CodeTable>().get(sender);
      return row && (row->flags & CodeRow::isPrivileged);
   }

}  // namespace

UniqueKvHandle XDb::open(DbId db, psio::view<const std::vector<char>> prefixView, KvMode mode)
{
   auto prefix        = std::span<const char>(prefixView);
   auto sender        = getSender();
   auto requirePrefix = [&]
   {
      auto expected = psio::convert_to_key(sender);
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
