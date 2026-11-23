// How many token transfers the chain processes, measured in the tester: no
// network, no HTTP, one block built in process.
//
// For each of {no signature, one signature} it prepares N distinct transfers,
// then times putting them all into one block. That is the node's full work per
// transaction as a block producer or validator does it: check the signature
// (if any), then execute. The unsigned run is the same work without the
// signature check.
//
// The heavy cases are hidden so the normal test run only does a quick pass:
//   psitest TransferBench-test.wasm "[bench]"
// Each line of output beginning with BENCH is one result.

#include <catch2/catch_all.hpp>
#include <chrono>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/user/Nft.hpp>
#include <services/user/Tokens.hpp>

using namespace SystemService;
using namespace UserService;
using namespace psibase;

namespace
{
   KeyPair senderKeys()
   {
      return KeyPair{
          AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(
              "-----BEGIN PUBLIC KEY-----\n"
              "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
              "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
              "-----END PUBLIC KEY-----\n")},
          AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(
              "-----BEGIN PRIVATE KEY-----\n"
              "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
              "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
              "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
              "-----END PRIVATE KEY-----\n")}};
   }

   double milliseconds(std::chrono::steady_clock::duration d)
   {
      return std::chrono::duration<double, std::milli>(d).count();
   }

   void run(std::size_t count, bool sign)
   {
      DefaultTestChain t;
      const auto       keys  = senderKeys();
      auto             alice = t.from(t.addAccount("alice"_a));
      auto             bob   = t.from(t.addAccount("bob"_a));
      bob.to<Tokens>().setUserConf(Tokens::autoDebit, true);

      auto     a     = alice.to<Tokens>();
      uint32_t token = a.create(Precision{4}, 1'000'000'000e4).returnVal();
      REQUIRE(alice.to<Nft>().debit(a.getToken(token).returnVal().nft_id, "").succeeded());
      REQUIRE(a.mint(token, 100'000'000e4, "supply").succeeded());
      // The first use of a service pays for loading it; keep that out of the timing.
      REQUIRE(a.credit(token, bob, 1e4, "warm").succeeded());

      KeyList signers;
      if (sign)
      {
         t.setAuth<AuthSig::AuthSig>(alice.id, keys.first);
         signers = {keys};
         REQUIRE(alice.with(signers).to<Tokens>().credit(token, bob, 1e4, "warm").succeeded());
      }
      t.finishBlock();

      // Build and sign everything first: only the chain's work is timed.
      t.startBlock();
      std::vector<SignedTransaction> transfers;
      transfers.reserve(count);
      std::size_t bytes = 0;
      for (std::size_t i = 0; i < count; ++i)
      {
         Action action{.sender  = alice.id,
                       .service = Tokens::service,
                       .method  = "credit"_m,
                       .rawData = psio::to_pssz(std::tuple(token, bob.id, Quantity{std::uint64_t{1}},
                                                           psibase::Memo{std::to_string(i)}))};
         auto signedTrx = t.signTransaction(t.makeTransaction({action}, 60), signers);
         bytes += signedTrx.transaction.size();
         for (const auto& proof : signedTrx.proofs)
            bytes += proof.size();
         transfers.push_back(std::move(signedTrx));
      }

      using clock      = std::chrono::steady_clock;
      const auto start = clock::now();
      std::size_t failed = 0;
      for (const auto& transfer : transfers)
      {
         auto trace = t.pushTransaction(transfer);
         failed += trace.error.has_value();
      }
      const auto pushed = clock::now();
      t.finishBlock();
      const auto finished = clock::now();

      const double total = milliseconds(finished - start);
      std::printf(
          "BENCH scenario=block signatures=%d transfers=%zu failed=%zu bytes_each=%zu "
          "execute_ms=%.2f finish_block_ms=%.2f total_ms=%.2f per_second=%.0f ms_each=%.4f\n",
          sign ? 1 : 0, count, failed, count ? bytes / count : 0, milliseconds(pushed - start),
          milliseconds(finished - pushed), total, count * 1000.0 / total, total / count);
      std::fflush(stdout);
      REQUIRE(failed == 0);
   }
}  // namespace

TEST_CASE("Transfers fill a block, signed and unsigned")
{
   run(20, false);
   run(20, true);
}

TEST_CASE("Transfer throughput in one block", "[.][bench]")
{
   for (std::size_t count : {1000u, 5000u})
   {
      run(count, false);
      run(count, true);
   }
}

TEST_CASE("Transfer throughput in one full block", "[.][bench-full]")
{
   // About what a 4 MiB block of signed transfers holds.
   run(13700, false);
   run(13700, true);
}
