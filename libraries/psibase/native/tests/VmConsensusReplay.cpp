#include "VmConsensusReplay.hpp"

#include <psibase/BlockContext.hpp>
#include <psibase/NativeFunctions.hpp>
#include <psibase/Socket.hpp>
#include <psibase/Watchdog.hpp>
#include <psibase/nativeTables.hpp>

#include <iostream>
#include <iterator>

namespace
{
   using namespace psibase;
   namespace replay = psibase::vm_consensus_replay;

   struct NullProver : Prover
   {
      std::vector<char> prove(std::span<const char>, const Claim&) const override { return {}; }
      bool remove(const Claim&) override { return false; }
      void get(std::vector<Claim>&) const override {}
      void get(std::vector<ClaimKey>&) const override {}
   };

   struct Result
   {
      bool passed = false;
      std::string profile;
      std::string inputBlockSha256;
      std::string inputBeforeSha256;
      std::string expectedAfterSha256;
      std::string actualAfterSha256;
      std::string blockHeaderSha256;
      std::string transactionTraceSha256;
      std::string proofTraceSha256;
      std::string traceScope = "All action/return/console/error data; only ActionTrace.totalTime is zeroed because it is non-consensus observation timing. Recorded subjectiveData and every resource balance/database byte remain unchanged.";
      uint64_t transactions = 0;
      uint64_t proofClaims = 0;
      uint32_t proofTimeoutMs = 200;
      std::vector<std::string> verifiedTransactionIds;
      std::vector<replay::NamespaceCount> namespaces;
   };
   PSIO1_REFLECT(Result, passed, profile, inputBlockSha256, inputBeforeSha256,
                expectedAfterSha256, actualAfterSha256, blockHeaderSha256,
                transactionTraceSha256, proofTraceSha256, traceScope,
                transactions, proofClaims, proofTimeoutMs, verifiedTransactionIds, namespaces)

   void normalizeTiming(ActionTrace& action)
   {
      action.totalTime = {};
      for (auto& trace : action.innerTraces)
         if (auto* child = std::get_if<ActionTrace>(&trace.inner)) normalizeTiming(*child);
   }
   void normalizeTiming(TransactionTrace& trace)
   {
      for (auto& action : trace.actionTraces) normalizeTiming(action);
   }

   std::vector<char> readFile(const std::filesystem::path& path)
   {
      check(std::filesystem::file_size(path) <= (256ull << 20), "replay metadata exceeds explicit limit");
      std::ifstream input(path, std::ios::binary);
      check(bool(input), "cannot read replay metadata");
      input.exceptions(std::ios::badbit);
      return {std::istreambuf_iterator<char>(input), {}};
   }

   void saveResult(const std::filesystem::path& path, const Result& result)
   {
      std::ofstream output(path);
      output.exceptions(std::ios::badbit | std::ios::failbit);
      output << psio1::convert_to_json(result) << '\n';
   }

   std::string profile()
   {
#if defined(PSIBASE_VM_LLVM_AOT)
      return "LLVM_AOT";
#elif defined(PSIBASE_VM_JIT2)
      return "JIT2";
#elif defined(PSIBASE_VM_JIT1)
      return "JIT1";
#else
      return "EOS_VM";
#endif
   }

   void run(const std::filesystem::path& input, const std::filesystem::path& output)
   {
      auto manifestBytes = readFile(input / "manifest.json");
      auto manifest = psio1::convert_from_json<replay::Manifest>(
          std::string(manifestBytes.data(), manifestBytes.size()));
      check(manifest.version == 1, "unsupported replay capture version");
      check(manifest.proofClaims > 0 && manifest.transactions > 0,
            "replay gate requires an existing proof-bearing transaction block");
      check(replay::fileHash(input / "block.frac") == manifest.blockSha256,
            "replay block input hash mismatch");
      check(replay::fileHash(input / "before.rows") == manifest.beforeSha256,
            "replay exact pre-block snapshot hash mismatch");
      check(replay::fileHash(input / "after.rows") == manifest.afterSha256,
            "replay expected objective snapshot hash mismatch");
      // Parse/validate the complete expected namespace catalog, not just its
      // digest. No chain namespace can be dropped to make equality pass.
      replay::readSnapshot(input / "after.rows", false, [](auto, auto&, auto&) {});
      auto blockBytes = readFile(input / "block.frac");
      auto source = psio1::from_frac<Block>(blockBytes);
      check(source.header.blockNum == manifest.blockNum &&
                source.transactions.size() == manifest.transactions,
            "replay block does not match its manifest");
      for (auto& trx : source.transactions)
      {
         check(trx.subjectiveData.has_value(), "replay transaction has no recorded subjective data");
         check(trx.proofs.size() == trx.transaction->claims().size(), "replay proof/claim count mismatch");
      }

      check(!std::filesystem::exists(output) && std::filesystem::create_directory(output),
            "replay output must be an exclusive new directory");
      std::filesystem::permissions(output, std::filesystem::perms::owner_all);
      replay::diskFloor(output);
      Result result;
      result.profile = profile();
      result.inputBlockSha256 = manifest.blockSha256;
      result.inputBeforeSha256 = manifest.beforeSha256;
      result.expectedAfterSha256 = manifest.afterSha256;
      saveResult(output / "result.json", result);

      SharedDatabase shared(output / "database", {64ull << 20, 64ull << 20, 64ull << 20, 64ull << 20});
      auto writer = shared.createWriter();
      auto sockets = std::make_shared<Sockets>(shared);
      {
         Database restored(shared, shared.getHead());
         auto write = restored.startWrite(writer);
         restored.checkoutSubjective();
         replay::readSnapshot(input / "before.rows", true,
             [&](DbId id, const std::vector<char>& key, const std::vector<char>& value)
             {
                restored.kvPutRaw(id, key, value);
             });
         SocketAutoCloseSet closing;
         check(restored.commitSubjective(*sockets, closing), "cannot restore replay subjective checkpoint");
         auto revision = write.writeRevision(source.header.previous);
         shared.setHead(*writer, revision);
      }
      // Verify byte-for-byte that restore preserved all objective AND
      // independent inputs, including auth roots, configuration and services.
      replay::snapshot(shared, shared.getHead(), output / "restored-before.rows", true);
      check(replay::sameFile(input / "before.rows", output / "restored-before.rows"),
            "replay restore changed input bytes");

      ExecutionContext::registerHostFunctions();
      SystemContext system{shared, WasmCache{128}, {}, std::make_shared<WatchdogManager>(), sockets};
      const auto expectedHeader = psio1::to_frac(source.header);
      BlockContext block(system, shared.getHead(), writer, false);
      block.start(std::move(source));
      Checksum256 transactionDigest{}, proofDigest{};
      for (auto& trx : block.current.transactions)
      {
         auto transactionId = sha256(trx.transaction.data(), trx.transaction.size());
         for (size_t i = 0; i < trx.proofs.size(); ++i)
         {
            TransactionTrace proof;
            // No preverified token/cache bypass and no budget relaxation.
            block.verifyProof(trx, proof, i, std::chrono::milliseconds(200), nullptr);
            check(!proof.error, "recorded valid transaction proof rejected during replay");
            normalizeTiming(proof);
            proofDigest = sha256(std::tuple{proofDigest, transactionId, uint64_t(i), proof});
            ++result.proofClaims;
         }
         if (!trx.proofs.empty()) result.verifiedTransactionIds.push_back(replay::hex(transactionId));
         TransactionTrace trace;
         block.exec(trx, trace, std::nullopt, false, true);
         check(!trace.error, "recorded valid transaction rejected during replay");
         normalizeTiming(trace);
         transactionDigest = sha256(std::tuple{transactionDigest, transactionId, trace});
         ++result.transactions;
      }
      auto [after, id] = block.writeRevision(NullProver{}, Claim{});
      shared.setHead(*writer, after);
      result.blockHeaderSha256 = replay::hex(sha256(psio1::to_frac(block.current.header)));
      result.transactionTraceSha256 = replay::hex(transactionDigest);
      result.proofTraceSha256 = replay::hex(proofDigest);
      result.namespaces = replay::snapshot(shared, after, output / "actual-after.rows", false);
      result.actualAfterSha256 = replay::fileHash(output / "actual-after.rows");
      saveResult(output / "result.json", result);
      check(result.proofClaims == manifest.proofClaims, "replay verified a different proof count");
      check(psio1::to_frac(block.current.header) == expectedHeader,
            "replay changed block header/transaction/event/consensus commitments");
      check(replay::sameFile(input / "after.rows", output / "actual-after.rows"),
            "replay changed objective database bytes");
      result.passed = true;
      saveResult(output / "result.json", result);
      std::cout << psio1::convert_to_json(result) << '\n';
   }
}

int main(int argc, char** argv)
{
   try
   {
      if (argc != 3)
      {
         std::cerr << "Usage: VmConsensusReplay CAPTURE_DIRECTORY NEW_OUTPUT_DIRECTORY\n";
         return 2;
      }
      run(std::filesystem::canonical(argv[1]), std::filesystem::absolute(argv[2]));
      return 0;
   }
   catch (const std::exception& error)
   {
      std::cerr << "Replay gate failed: " << error.what() << '\n';
      return 1;
   }
}
