#include <psibase/Table.hpp>

#include <services/local/XDb.hpp>
#include <services/system/Db.hpp>

using namespace psibase;

UniqueKvHandle psibase::proxyKvOpen(DbId db, std::span<const char> prefix, KvMode mode)
{
   if (db < DbId::beginIndependent)
   {
      return UniqueKvHandle{to<SystemService::Db>().open(db, prefix, mode)};
   }
   else
   {
      return UniqueKvHandle{to<LocalService::XDb>().open(db, prefix, mode)};
   }
}
