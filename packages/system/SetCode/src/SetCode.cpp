#include <psibase/dispatch.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;

namespace SystemService
{

   namespace
   {
      bool incrementRefCount(CodeRefCountTable& refsTable,
                             const Checksum256& codeHash,
                             std::uint8_t       vmType,
                             std::uint8_t       vmVersion)
      {
         auto count = CodeRefCountRow{codeHash, vmType, vmVersion, 0};
         if (auto row = refsTable.get(count.key()))
         {
            count = *row;
         }
         ++count.numRefs;
         check(count.numRefs != 0, "Integer overflow");
         refsTable.put(count);
         return count.numRefs > 1;
      }

      void decrementRefCount(CodeRefCountTable& refsTable,
                             CodeByHashTable&   codeTable,
                             const Checksum256& codeHash,
                             std::uint8_t       vmType,
                             std::uint8_t       vmVersion)
      {
         auto prevCount = refsTable.get(std::tuple(codeHash, vmType, vmVersion));
         check(prevCount.has_value(), "Missing reference count");
         if (--prevCount->numRefs)
            refsTable.put(*prevCount);
         else
         {
            refsTable.remove(*prevCount);
            codeTable.erase(std::tuple(codeHash, vmType, vmVersion));
         }
      }

      void incrementVerifySeq(std::uint64_t flags)
      {
         if (flags & CodeRow::isVerify)
         {
            auto status = getStatus();
            if (status.consensus.next && status.consensus.next->blockNum != status.current.blockNum)
               abortMessage("Cannot update verify services while a consensus update is pending");
            auto verifySeq = SetCode{}.open<VerifySequenceTable>();
            auto row       = verifySeq.get({}).value_or(VerifySequenceRow{});
            ++row.seq;
            verifySeq.put(row);
         }
      }
   }  // namespace

   void SetCode::init()
   {
      auto refsTable = Tables{}.open<CodeRefCountTable>();
      auto codeTable =
          Table<CodeRow, &CodeRow::codeNum>{CodeRow::db, psio::convert_to_key(codePrefix())};
      auto stagedTable = Tables{}.open<StagedCodeTable>();
      // clear ref counts table
      for (auto row : refsTable.getIndex<0>())
      {
         refsTable.remove(row);
      }
      // scan code table and increment ref counts
      for (auto row : codeTable.getIndex<0>())
      {
         incrementRefCount(refsTable, row.codeHash, row.vmType, row.vmVersion);
      }
      // scan staged code
      for (auto row : stagedTable.getIndex<0>())
      {
         incrementRefCount(refsTable, row.codeHash, row.vmType, row.vmVersion);
      }
   }

   void SetCode::setCode(AccountNumber     service,
                         uint8_t           vmType,
                         uint8_t           vmVersion,
                         std::vector<char> code)
   {
      auto refsTable       = Tables{}.open<CodeRefCountTable>();
      auto native          = Native::tables();
      auto codeTable       = native.open<CodeTable>();
      auto codeByHashTable = native.open<CodeByHashTable>();
      // TODO: validate code here?
      // TODO: special rule for resource charging: pretend CodeByHashRow isn't shared
      // TODO: move numRefs to a different row?
      check(getSender() == service, "sender must match service account");
      check(vmType == 0 && vmVersion == 0, "unsupported type or version");

      auto account = codeTable.get(service);
      if (!account)
      {
         account.emplace();
         account->codeNum = service;
      }

      Checksum256 codeHash = {};
      if (!code.empty())
         codeHash = sha256(code.data(), code.size());
      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return;

      // decrement old reference count
      if (account->codeHash != Checksum256{})
      {
         decrementRefCount(refsTable, codeByHashTable, account->codeHash, account->vmType,
                           account->vmVersion);
      }

      incrementVerifySeq(account->flags);

      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      if (account->codeHash != Checksum256{} || account->flags)
         codeTable.put(*account);
      else
         codeTable.remove(*account);

      if (!code.empty())
      {
         if (!incrementRefCount(refsTable, codeHash, vmType, vmVersion))
         {
            CodeByHashRow code_obj{.codeHash  = account->codeHash,
                                   .vmType    = account->vmType,
                                   .vmVersion = account->vmVersion,
                                   .code{code.begin(), code.end()}};
            codeByHashTable.put(code_obj);
         }
      }
   }  // setCode

   void SetCode::stageCode(psibase::AccountNumber service,
                           std::uint64_t          id,
                           uint8_t                vmType,
                           uint8_t                vmVersion,
                           std::vector<char>      code)
   {
      auto sender     = getSender();
      auto tables     = Tables{};
      auto refsTable  = tables.open<CodeRefCountTable>();
      auto stagedCode = tables.open<StagedCodeTable>();

      check(!code.empty(), "Cannot stage empty code");
      check(vmType == 0 && vmVersion == 0, "unsupported type or version");

      Checksum256 codeHash = sha256(code.data(), code.size());

      auto row = StagedCodeRow{
          .from      = sender,
          .service   = service,
          .id        = id,
          .codeHash  = codeHash,
          .vmType    = vmType,
          .vmVersion = vmVersion,
      };
      check(!stagedCode.get(row.key()), "staged code id must be unique");

      if (!incrementRefCount(refsTable, codeHash, vmType, vmVersion))
      {
         auto          native          = Native::tables();
         auto          codeByHashTable = native.open<CodeByHashTable>();
         CodeByHashRow code_obj{.codeHash  = codeHash,
                                .vmType    = vmType,
                                .vmVersion = vmVersion,
                                .code{code.begin(), code.end()}};
         codeByHashTable.put(code_obj);
      }
      stagedCode.put(row);
   }

   void SetCode::unstageCode(psibase::AccountNumber service, std::uint64_t id)
   {
      auto sender     = getSender();
      auto tables     = Tables{};
      auto refsTable  = tables.open<CodeRefCountTable>();
      auto stagedCode = tables.open<StagedCodeTable>();

      auto row = stagedCode.get(std::tuple(sender, id, service));
      check(row.has_value(), "staged code does not exist");

      auto native          = Native::tables();
      auto codeByHashTable = native.open<CodeByHashTable>();
      decrementRefCount(refsTable, codeByHashTable, row->codeHash, row->vmType, row->vmVersion);
      stagedCode.remove(*row);
   }

   void SetCode::setCodeStaged(psibase::AccountNumber from,
                               std::uint64_t          id,
                               uint8_t                vmType,
                               uint8_t                vmVersion,
                               psibase::Checksum256   codeHash)
   {
      auto sender     = getSender();
      auto service    = sender;
      auto tables     = Tables{};
      auto refsTable  = tables.open<CodeRefCountTable>();
      auto stagedCode = tables.open<StagedCodeTable>();
      auto native     = Native::tables();
      auto codeTable  = native.open<CodeTable>();

      check(vmType == 0 && vmVersion == 0, "unsupported type or version");

      // Verify and remove the staged code record
      auto staged = stagedCode.get(std::tuple(from, id, service));
      check(staged.has_value(), "staged code does not exist");
      check(staged->codeHash == codeHash && staged->vmType == vmType &&
                staged->vmVersion == vmVersion,
            "staged code does not match");
      stagedCode.remove(*staged);

      auto account = codeTable.get(service);
      if (!account)
      {
         account.emplace();
         account->codeNum = service;
      }

      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return;

      // decrement old reference count
      if (account->codeHash != Checksum256{})
      {
         auto codeByHashTable = native.open<CodeByHashTable>();
         decrementRefCount(refsTable, codeByHashTable, account->codeHash, account->vmType,
                           account->vmVersion);
      }

      incrementVerifySeq(account->flags);

      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      codeTable.put(*account);
   }

   void SetCode::setFlags(psibase::AccountNumber service, uint64_t flags)
   {
      check(getSender() == getReceiver(), "incorrect sender");
      auto native    = Native::tables();
      auto codeTable = native.open<CodeTable>();
      auto account   = codeTable.get(service);
      if (!account)
      {
         account.emplace();
         account->codeNum = service;
      }
      incrementVerifySeq(account->flags ^ flags);

      account->flags = flags;
      if (account->codeHash != Checksum256{} || account->flags)
         codeTable.put(*account);
      else
         codeTable.remove(*account);
   }

   std::uint64_t SetCode::verifySeq()
   {
      return open<VerifySequenceTable>(KvMode::read).get({}).value_or(VerifySequenceRow{}).seq;
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::SetCode)
