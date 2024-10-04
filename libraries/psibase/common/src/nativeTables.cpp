#include <psibase/nativeTables.hpp>

#include <algorithm>

namespace psibase
{
   auto statusKey() -> KeyPrefixType
   {
      return std::tuple{statusTable, nativeTablePrimaryIndex};
   }
   auto StatusRow::key() -> KeyPrefixType
   {
      return statusKey();
   }

   auto ConfigRow::key() -> KeyPrefixType
   {
      return std::tuple{configTable, nativeTablePrimaryIndex};
   }

   auto WasmConfigRow::key(NativeTableNum TableNum) -> KeyPrefixType
   {
      return std::tuple{TableNum, nativeTablePrimaryIndex};
   }

   auto codePrefix() -> KeyPrefixType
   {
      return std::tuple{codeTable, nativeTablePrimaryIndex};
   }

   auto codeKey(AccountNumber codeNum) -> CodeKeyType
   {
      return std::tuple{codeTable, nativeTablePrimaryIndex, codeNum};
   }

   auto CodeRow::key() const -> CodeKeyType
   {
      return codeKey(codeNum);
   }

   auto codeByHashKey(const Checksum256& codeHash,
                      uint8_t            vmType,
                      uint8_t            vmVersion) -> CodeByHashKeyType
   {
      return std::tuple{codeByHashTable, nativeTablePrimaryIndex, codeHash, vmType, vmVersion};
   }

   auto CodeByHashRow::key() const -> CodeByHashKeyType
   {
      return codeByHashKey(codeHash, vmType, vmVersion);
   }

   auto getCodeKeys(const std::vector<BlockHeaderAuthAccount>& services)
       -> std::vector<CodeByHashKeyType>
   {
      std::vector<decltype(codeByHashKey(Checksum256(), 0, 0))> result;
      for (const auto& s : services)
      {
         result.push_back(codeByHashKey(s.codeHash, s.vmType, s.vmVersion));
      }
      std::sort(result.begin(), result.end());
      result.erase(std::unique(result.begin(), result.end()), result.end());
      return result;
   }

   auto databaseStatusKey() -> KeyPrefixType
   {
      return std::tuple{databaseStatusTable, nativeTablePrimaryIndex};
   }
   auto DatabaseStatusRow::key() -> KeyPrefixType
   {
      return databaseStatusKey();
   }

   auto notifyKey(NotifyType type) -> NotifyKeyType
   {
      return std::tuple{notifyTable, nativeTablePrimaryIndex, type};
   }
   auto NotifyRow::key() const -> NotifyKeyType
   {
      return notifyKey(type);
   }

   auto blockDataPrefix() -> KeyPrefixType
   {
      return std::tuple{blockDataTable, nativeTablePrimaryIndex};
   }
   auto blockDataKey(const Checksum256& id) -> BlockDataKeyType
   {
      return std::tuple{blockDataTable, nativeTablePrimaryIndex, id};
   }
   auto BlockDataRow::key() const -> BlockDataKeyType
   {
      return blockDataKey(blockId);
   }

   auto consensusChangePrefix() -> KeyPrefixType
   {
      return std::tuple{consensusChangeTable, nativeTablePrimaryIndex};
   }
   auto consensusChangeKey(BlockNum num) -> ConsensusChangeKeyType
   {
      return std::tuple{consensusChangeTable, nativeTablePrimaryIndex, num};
   }
   auto ConsensusChangeRow::key() const -> ConsensusChangeKeyType
   {
      return consensusChangeKey(start);
   }
}  // namespace psibase
