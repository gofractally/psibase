#include <psibase/Table.hpp>

#include <services/system/Db.hpp>

using namespace psibase;

UniqueKvHandle psibase::proxyKvOpen(DbId db, std::span<const char> prefix, KvMode mode)
{
   return UniqueKvHandle{kvOpen(db, prefix, mode)};
}
