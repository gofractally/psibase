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
   void dbError(AccountNumber sender, DbId db, std::string_view verb)
   {
      std::string message = sender.str() + " cannot ";
      message += verb;
      message += " db ";
      message += to_string(db);
      abortMessage(message);
   }
   void prefixError(AccountNumber sender, std::span<const char> prefix)
   {
      std::string message = sender.str() + " cannot write to another service's prefix";
      if (prefix.size() >= sizeof(std::uint64_t))
      {
         std::uint64_t value;
         auto          endService = prefix.begin() + sizeof(std::uint64_t);
         std::reverse_copy(prefix.begin(), endService, reinterpret_cast<char*>(&value));
         message += ": ";
         message += AccountNumber{value}.str();
         if (prefix.end() - endService >= sizeof(std::uint16_t))
         {
            auto          endTable = endService + sizeof(std::uint16_t);
            std::uint16_t table;
            std::reverse_copy(endService, endTable, reinterpret_cast<char*>(&table));
            message += ':';
            message += std::to_string(table);
         }
      }
      abortMessage(message);
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
            prefixError(sender, prefix);
         }
      }
   }
   else if (db == DbId::native)
   {
      if (isWrite(mode) && !isPrivileged(sender))
      {
         dbError(sender, db, "write");
      }
   }
   else if (db == DbId::blockLog)
   {
      if (isWrite(mode))
      {
         dbError(sender, db, "write");
      }
   }
   else
   {
      dbError(sender, db, "open");
   }

   return UniqueKvHandle{psibase::kvOpen(db, prefix, mode)};
}

PSIBASE_DISPATCH(Db)
