#include <cstdint>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/trace.hpp>
#include <psio1/view.hpp>

namespace TestService
{
   struct BlockCountRow
   {
      std::uint32_t count;
   };
   PSIO1_REFLECT(BlockCountRow, count)
   using BlockCountTable = psibase::Table<BlockCountRow, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(BlockCountTable)

   struct TransactionCountRow
   {
      std::uint32_t count;
   };
   PSIO1_REFLECT(TransactionCountRow, count)
   using TransactionCountTable = psibase::Table<TransactionCountRow, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(TransactionCountTable)

   struct FailRow
   {
   };
   PSIO1_REFLECT(FailRow);
   using FailTable = psibase::Table<FailRow, psibase::SingletonKey{}>;
   PSIO1_REFLECT_TYPENAME(FailTable)

   struct NotifyService : psibase::Service
   {
      using WriteOnly  = psibase::WriteOnlyTables<BlockCountTable, TransactionCountTable>;
      using Subjective = psibase::SubjectiveTables<FailTable>;
      static constexpr auto service = psibase::AccountNumber{"notify1"};
      void                  onBlock();
      void onTrx(const psibase::Checksum256& id, psio1::view<const psibase::TransactionTrace> trace);
   };
   PSIO1_REFLECT(NotifyService, method(onBlock), method(onTrx, id, trace));
   PSIBASE_REFLECT_TABLES(NotifyService, NotifyService::WriteOnly, NotifyService::Subjective)
}  // namespace TestService
