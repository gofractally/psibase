#include <cstdint>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/trace.hpp>
#include <psio/view.hpp>

namespace TestService
{
   struct BlockCountRow
   {
      std::uint32_t count;
   };
   PSIO_REFLECT(BlockCountRow, count)
   using BlockCountTable = psibase::Table<BlockCountRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(BlockCountTable)

   struct TransactionCountRow
   {
      std::uint32_t count;
   };
   PSIO_REFLECT(TransactionCountRow, count)
   using TransactionCountTable = psibase::Table<TransactionCountRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(TransactionCountTable)

   struct FailRow
   {
   };
   PSIO_REFLECT(FailRow);
   using FailTable = psibase::Table<FailRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(FailTable)

   struct NotifyService : psibase::Service
   {
      using WriteOnly  = psibase::WriteOnlyTables<BlockCountTable, TransactionCountTable>;
      using Subjective = psibase::SubjectiveTables<FailTable>;
      static constexpr auto service = psibase::AccountNumber{"notify1"};
      void                  onBlock();
      void onTrx(const psibase::Checksum256& id, psio::view<const psibase::TransactionTrace> trace);
   };
   PSIO_REFLECT(NotifyService, method(onBlock), method(onTrx, id, trace));
   PSIBASE_REFLECT_TABLES(NotifyService, NotifyService::WriteOnly, NotifyService::Subjective)
}  // namespace TestService
