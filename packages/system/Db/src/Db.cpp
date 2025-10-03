#include <services/system/Db.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;
using namespace SystemService;

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

   bool isPrivileged(AccountNumber sender)
   {
      auto row = Native::tablesDirect(KvMode::read).open<CodeTable>().get(sender);
      return row && (row->flags & CodeRow::isPrivileged);
   }
}  // namespace

UniqueKvHandle Db::open(DbId db, psio::view<const std::vector<char>> prefixView, KvMode mode)
{
   auto prefix = std::span<const char>(prefixView);
   auto sender = getSender();
   if (db == DbId::service || db == DbId::writeOnly)
   {
      if (isWrite(mode))
      {
         auto expected = psio::convert_to_key(sender);
         if (!std::ranges::starts_with(prefix, expected))
         {
            abortMessage("Cannot write to another service's prefix");
         }
      }
   }
   else if (db == DbId::native)
   {
      if (isWrite(mode) && !isPrivileged(sender))
      {
         abortMessage("Service cannot write this db");
      }
   }
   else if (db == DbId::blockLog)
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

PSIBASE_DISPATCH(Db)
