#pragma once

// Opt-in capture of an existing test's real block. This is verification
// instrumentation, not a new workload or part of the chain wire format.
#include <psibase/crypto.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psio1/from_json.hpp>
#include <psio1/to_json.hpp>
#include <openssl/evp.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <fstream>
#include <memory>
#include <span>
#include <string>
#include <system_error>
#include <vector>
#include <unistd.h>

namespace psibase::vm_consensus_replay
{
   inline std::string hex(const Checksum256& value)
   {
      std::string out;
      for (auto b : value)
      {
         out += "0123456789abcdef"[b >> 4];
         out += "0123456789abcdef"[b & 15];
      }
      return out;
   }

   inline std::string fileHash(const std::filesystem::path& path)
   {
      std::ifstream input(path, std::ios::binary);
      input.exceptions(std::ios::badbit);
      check(bool(input), "cannot read replay evidence");
      std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
      check(context && EVP_DigestInit_ex(context.get(), EVP_sha256(), nullptr) == 1,
            "cannot initialize replay evidence hash");
      std::array<char, 65536> buffer;
      while (input)
      {
         input.read(buffer.data(), buffer.size());
         check(EVP_DigestUpdate(context.get(), buffer.data(), input.gcount()) == 1,
               "cannot hash replay evidence");
      }
      Checksum256 digest;
      unsigned size = 0;
      check(EVP_DigestFinal_ex(context.get(), digest.data(), &size) == 1 && size == digest.size(),
            "cannot finish replay evidence hash");
      return hex(digest);
   }

   inline void diskFloor(const std::filesystem::path& path)
   {
      check(std::filesystem::space(path).available >= (15ull << 30),
            "replay evidence requires 15 GiB free disk floor");
   }

   inline void writeUint(std::ostream& out, uint64_t value, unsigned width)
   {
      for (unsigned i = 0; i < width; ++i) out.put(char(value >> (8 * i)));
   }
   inline uint64_t readUint(std::istream& in, unsigned width)
   {
      uint64_t result = 0;
      for (unsigned i = 0; i < width; ++i)
      {
         int byte = in.get();
         check(byte != EOF, "truncated replay snapshot integer");
         result |= uint64_t(uint8_t(byte)) << (8 * i);
      }
      return result;
   }

   struct NamespaceCount
   {
      uint32_t db;
      uint64_t rows;
      uint64_t bytes;
   };
   PSIO_REFLECT(NamespaceCount, db, rows, bytes)

   struct Manifest
   {
      uint32_t version = 1;
      std::string chainName;
      uint32_t blockNum = 0;
      uint64_t transactions = 0;
      uint64_t proofClaims = 0;
      std::string blockSha256;
      std::string beforeSha256;
      std::string afterSha256;
      std::vector<NamespaceCount> beforeNamespaces;
      std::vector<NamespaceCount> afterNamespaces;
   };
   PSIO_REFLECT(Manifest, version, chainName, blockNum, transactions, proofClaims,
                blockSha256, beforeSha256, afterSha256, beforeNamespaces, afterNamespaces)

   inline std::vector<DbId> namespaces(bool independent)
   {
      std::vector<DbId> result;
      for (uint32_t i = 0; i < numChainDatabases; ++i) result.push_back(DbId(i));
      if (independent)
         for (uint32_t i = uint32_t(DbId::beginIndependent); i < uint32_t(DbId::endIndependent); ++i)
            result.push_back(DbId(i));
      return result;
   }

   inline std::vector<NamespaceCount> snapshot(SharedDatabase shared, ConstRevisionPtr revision,
                                                const std::filesystem::path& path, bool independent)
   {
      diskFloor(path.parent_path());
      Database database(shared, revision);
      auto read = database.startRead();
      if (independent) database.checkoutSubjective();
      std::ofstream out(path, std::ios::binary | std::ios::trunc);
      out.exceptions(std::ios::badbit | std::ios::failbit);
      out.write("PSIBASE-REPLAY-1\n", 17);
      auto ids = namespaces(independent);
      writeUint(out, ids.size(), 4);
      std::vector<NamespaceCount> result;
      for (auto id : ids)
      {
         diskFloor(path.parent_path());
         writeUint(out, uint32_t(id), 4);
         auto countPosition = out.tellp();
         writeUint(out, 0, 8);
         NamespaceCount count{uint32_t(id), 0, 0};
         std::vector<char> key;
         while (auto row = database.kvGreaterEqualRaw(id, key, 0))
         {
            auto k = row->key.string_view();
            auto v = row->value.string_view();
            check(k.size() <= (256ull << 20) && v.size() <= (256ull << 20),
                  "replay snapshot row exceeds explicit 256 MiB limit");
            writeUint(out, k.size(), 8);
            writeUint(out, v.size(), 8);
            out.write(k.data(), k.size());
            out.write(v.data(), v.size());
            key.assign(k.begin(), k.end());
            key.push_back('\0');  // immediate lexicographic successor
            ++count.rows;
            count.bytes += k.size() + v.size();
            check(count.bytes <= (2ull << 30), "replay namespace exceeds explicit 2 GiB limit");
            if (count.rows % 1024 == 0) diskFloor(path.parent_path());
         }
         auto end = out.tellp();
         out.seekp(countPosition);
         writeUint(out, count.rows, 8);
         out.seekp(end);
         result.push_back(count);
      }
      if (independent) database.abortSubjective();
      out.close();
      return result;
   }

   template <class Put>
   void readSnapshot(const std::filesystem::path& path, bool independent, Put&& put)
   {
      std::ifstream in(path, std::ios::binary);
      check(bool(in), "cannot open replay snapshot");
      std::array<char, 17> magic;
      in.read(magic.data(), magic.size());
      check(in.gcount() == magic.size() && std::string_view(magic.data(), magic.size()) == "PSIBASE-REPLAY-1\n",
            "invalid replay snapshot magic");
      auto ids = namespaces(independent);
      check(readUint(in, 4) == ids.size(), "replay snapshot namespace count mismatch");
      for (auto expected : ids)
      {
         check(readUint(in, 4) == uint32_t(expected), "replay snapshot omitted or reordered a namespace");
         auto count = readUint(in, 8);
         check(count <= 100000000, "replay snapshot row count exceeds explicit limit");
         std::vector<char> previous;
         bool first = true;
         uint64_t total = 0;
         for (uint64_t i = 0; i < count; ++i)
         {
            auto keySize = readUint(in, 8), valueSize = readUint(in, 8);
            check(keySize <= (256ull << 20) && valueSize <= (256ull << 20),
                  "replay snapshot row exceeds explicit limit");
            total += keySize + valueSize;
            check(total <= (2ull << 30), "replay snapshot namespace exceeds explicit limit");
            std::vector<char> key(keySize), value(valueSize);
            in.read(key.data(), key.size());
            check(in.gcount() == key.size(), "truncated replay snapshot key");
            in.read(value.data(), value.size());
            check(in.gcount() == value.size(), "truncated replay snapshot value");
            // std::string comparisons use unsigned byte ordering, matching
            // Triedent. Comparing vector<char> would depend on signed char.
            check(first || std::string_view(previous.data(), previous.size()) < std::string_view(key.data(), key.size()),
                  "replay snapshot keys are not strictly ordered");
            put(expected, key, value);
            first = false;
            previous = std::move(key);
         }
      }
      check(in.peek() == EOF, "replay snapshot has trailing bytes");
   }

   inline bool sameFile(const std::filesystem::path& left, const std::filesystem::path& right)
   {
      if (std::filesystem::file_size(left) != std::filesystem::file_size(right)) return false;
      std::ifstream a(left, std::ios::binary), b(right, std::ios::binary);
      check(bool(a) && bool(b), "cannot compare replay snapshots");
      std::array<char, 65536> x, y;
      while (a)
      {
         a.read(x.data(), x.size());
         b.read(y.data(), y.size());
         if (a.gcount() != b.gcount() || !std::equal(x.begin(), x.begin() + a.gcount(), y.begin())) return false;
      }
      check(!a.bad() && !b.bad(), "cannot read replay snapshots during comparison");
      return true;
   }

   class Capture
   {
      std::filesystem::path directory;
      Manifest manifest;
      bool complete = false;
      inline static std::atomic<bool> captured = false;

      void clear()
      {
         if (!directory.empty() && !complete) std::filesystem::remove_all(directory);
         directory.clear();
         complete = false;
      }

     public:
      Capture() = default;
      Capture(const Capture&) = delete;
      Capture& operator=(const Capture&) = delete;
      ~Capture()
      {
         // An opt-in capture error is useful evidence. Keep its partial
         // directory when unwinding, rather than erasing the failed attempt.
         if (std::uncaught_exceptions()) return;
         try { clear(); } catch (...) {}
      }
      void begin(SharedDatabase shared, ConstRevisionPtr before, std::string name)
      {
         clear();
         const char* destination = std::getenv("PSIBASE_VM_REPLAY_CAPTURE");
         if (!destination || captured.load()) return;
         auto base = std::filesystem::absolute(destination);
         std::filesystem::create_directories(base);
         diskFloor(base);
         std::string pattern = (base / "existing-signed-block-XXXXXX").string();
         check(::mkdtemp(pattern.data()) != nullptr, "cannot create exclusive replay evidence directory");
         directory = pattern;
         manifest = {};
         manifest.chainName = std::move(name);
         manifest.beforeNamespaces = snapshot(shared, before, directory / "before.rows", true);
         manifest.beforeSha256 = fileHash(directory / "before.rows");
      }
      void finish(SharedDatabase shared, ConstRevisionPtr after, const Block& block)
      {
         if (directory.empty()) return;
         uint64_t claims = 0;
         for (auto& trx : block.transactions)
         {
            check(trx.subjectiveData.has_value(), "cannot capture block without exact subjective data");
            check(trx.proofs.size() == trx.transaction->claims().size(), "cannot capture malformed proof counts");
            claims += trx.proofs.size();
         }
         if (!claims || captured.exchange(true))
         {
            clear();
            return;
         }
         manifest.blockNum = block.header.blockNum;
         manifest.transactions = block.transactions.size();
         manifest.proofClaims = claims;
         manifest.afterNamespaces = snapshot(shared, after, directory / "after.rows", false);
         manifest.afterSha256 = fileHash(directory / "after.rows");
         auto bytes = psio::to_pssz(block);
         std::ofstream out(directory / "block.frac", std::ios::binary);
         out.exceptions(std::ios::badbit | std::ios::failbit);
         out.write(bytes.data(), bytes.size());
         out.close();
         manifest.blockSha256 = fileHash(directory / "block.frac");
         std::ofstream json(directory / "manifest.json");
         json.exceptions(std::ios::badbit | std::ios::failbit);
         json << psio1::convert_to_json(manifest) << '\n';
         json.close();
         complete = true;
      }
   };
}
