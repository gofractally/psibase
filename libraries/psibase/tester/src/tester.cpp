#include <psibase/tester.hpp>

#include <secp256k1.h>
#include <services/system/TransactionSys.hpp>
#include <services/system/VerifyEcSys.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

extern "C"
{
   // clang-format off
   [[clang::import_name("testerCreateChain")]]      uint32_t testerCreateChain(uint64_t hot_bytes, uint64_t warm_bytes, uint64_t cool_bytes, uint64_t cold_bytes);
   [[clang::import_name("testerDestroyChain")]]     void     testerDestroyChain(uint32_t chain);
   [[clang::import_name("testerFinishBlock")]]      void     testerFinishBlock(uint32_t chain_index);
   [[clang::import_name("testerGetChainPath")]]     uint32_t testerGetChainPath(uint32_t chain, char* dest, uint32_t dest_size);
   [[clang::import_name("testerPushTransaction")]]  uint32_t testerPushTransaction(uint32_t chain_index, const char* args_packed, uint32_t args_packed_size);
   [[clang::import_name("testerSelectChainForDb")]] void     testerSelectChainForDb(uint32_t chain_index);
   [[clang::import_name("testerShutdownChain")]]    void     testerShutdownChain(uint32_t chain);
   [[clang::import_name("testerStartBlock")]]       void     testerStartBlock(uint32_t chain_index, uint32_t time_seconds);
   // clang-format on
}

psibase::TraceResult::TraceResult(TransactionTrace&& t) : _t(t) {}

bool psibase::TraceResult::succeeded()
{
   bool hasErrObj = (_t.error != std::nullopt);
   bool failed    = hasErrObj && (*_t.error) != "";
   if (failed)
   {
      UNSCOPED_INFO("transaction failed: " << *_t.error << "\n");
   }

   return !failed;
}

bool psibase::TraceResult::failed(std::string_view expected)
{
   bool failed = (_t.error != std::nullopt);
   if (!failed)
   {
      UNSCOPED_INFO("transaction succeeded, but was expected to fail");
      return false;
   }

   bool hasException = (failed && _t.error.has_value());
   if (hasException)
   {
      if (_t.error->find(expected.data()) != std::string::npos)
      {
         return true;
      }
      else
      {
         UNSCOPED_INFO("transaction was expected to fail with: \""
                       << expected << "\", but it failed with: \"" << *_t.error << "\"\n");
      }
   }

   return false;
}

std::vector<char> psibase::readWholeFile(std::string_view filename)
{
   auto fail = [&] { check(false, "read " + std::string(filename) + " failed"); };
   int  fd   = ::open(std::string(filename).c_str(), O_RDONLY);
   if (fd < 0)
      fail();
   struct stat stat;
   if (::fstat(fd, &stat) < 0)
      fail();
   if (stat.st_size > std::numeric_limits<std::size_t>::max())
      fail();
   std::vector<char> result(static_cast<std::size_t>(stat.st_size));
   char*             pos       = result.data();
   std::size_t       remaining = result.size();
   while (remaining)
   {
      auto count = ::read(fd, pos, remaining);
      if (count < 0)
         fail();
      remaining -= count;
      pos += count;
   }
   ::close(fd);
   return result;
}

void psibase::expect(TransactionTrace t, const std::string& expected, bool always_show)
{
   std::string error = t.error ? *t.error : "";
   bool bad = (expected.empty() && !error.empty()) || error.find(expected) == std::string::npos;
   if (bad || always_show)
      std::cout << prettyTrace(trimRawData(std::move(t))) << "\n";
   if (bad)
   {
      if (expected.empty())
         check(false, "transaction failed");
      else
         check(false, "transaction was expected to fail with " + expected);
   }
}

psibase::Signature psibase::sign(const PrivateKey& key, const Checksum256& digest)
{
   static auto context = secp256k1_context_create(SECP256K1_CONTEXT_SIGN);
   auto*       k1      = std::get_if<0>(&key.data);
   check(k1, "only k1 currently supported");

   secp256k1_ecdsa_signature sig;
   check(secp256k1_ecdsa_sign(context, &sig, reinterpret_cast<const unsigned char*>(digest.data()),
                              k1->data(), nullptr, nullptr) == 1,
         "sign failed");

   EccSignature sigdata;
   check(secp256k1_ecdsa_signature_serialize_compact(context, sigdata.data(), &sig) == 1,
         "serialize signature failed");
   return Signature{Signature::variant_type{std::in_place_index<0>, sigdata}};
}

const psibase::PublicKey psibase::TestChain::defaultPubKey =
    psibase::publicKeyFromString("PUB_K1_8UUMcamEE6dnK4kyrSPnAEAPTWZduZtE9SuFvURr3UjGDpF9LX");
const psibase::PrivateKey psibase::TestChain::defaultPrivKey =
    psibase::privateKeyFromString("PVT_K1_27Hseiioosmff4ue31Jv37pC1NWfhbjuKuSBxEkqCTzbJtxQD2");

psibase::TestChain::TestChain(const DatabaseConfig& dbconfig)
    : id{::testerCreateChain(dbconfig.hotBytes,
                             dbconfig.warmBytes,
                             dbconfig.coolBytes,
                             dbconfig.coldBytes)}
{
}

psibase::TestChain::TestChain(uint64_t hot_bytes,
                              uint64_t warm_bytes,
                              uint64_t cool_bytes,
                              uint64_t cold_bytes)
    : id{::testerCreateChain(hot_bytes, warm_bytes, cool_bytes, cold_bytes)}
{
}

psibase::TestChain::~TestChain()
{
   ::testerDestroyChain(id);
}

void psibase::TestChain::shutdown()
{
   ::testerShutdownChain(id);
}

std::string psibase::TestChain::getPath()
{
   size_t      len = testerGetChainPath(id, nullptr, 0);
   std::string result(len, 0);
   testerGetChainPath(id, result.data(), len);
   return result;
}

void psibase::TestChain::setAutoBlockStart(bool enable)
{
   isAutoBlockStart = enable;
}

void psibase::TestChain::startBlock(int64_t skip_miliseconds)
{
   auto time = status ? status->current.time : TimePointSec{};
   startBlock(TimePointSec{time.seconds + 1 + uint32_t(skip_miliseconds / 1000)});
}

void psibase::TestChain::startBlock(std::string_view time)
{
   uint64_t value;
   auto     data = time.data();
   check(stringToUtcMicroseconds(value, data, data + time.size(), true), "bad time");
   startBlock(TimePointSec{.seconds = uint32_t(value / 1000)});
}

void psibase::TestChain::startBlock(TimePointSec tp)
{
   // Guarantee that there is a recent block for fillTapos to use.
   if (status && status->current.time.seconds + 1 < tp.seconds)
      ::testerStartBlock(id, tp.seconds - 1);
   ::testerStartBlock(id, tp.seconds);
   status    = psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
   producing = true;
}

void psibase::TestChain::finishBlock()
{
   ::testerFinishBlock(id);
   producing = false;
}

void psibase::TestChain::fillTapos(Transaction& t, uint32_t expire_sec) const
{
   t.tapos.expiration.seconds = (status ? status->current.time.seconds : 0) + expire_sec;
   auto [index, suffix]       = SystemService::headTapos();
   t.tapos.refBlockIndex      = index;
   t.tapos.refBlockSuffix     = suffix;
}

psibase::Transaction psibase::TestChain::makeTransaction(std::vector<Action>&& actions) const
{
   Transaction t;
   fillTapos(t);
   t.actions = std::move(actions);
   return t;
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(
    const SignedTransaction& signedTrx)
{
   if (!producing)
      startBlock();
   std::vector<char> packed_trx = psio::convert_to_frac(signedTrx);
   auto              size       = ::testerPushTransaction(id, packed_trx.data(), packed_trx.size());
   return psio::from_frac<TransactionTrace>(getResult(size));
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(Transaction    trx,
                                                                            const KeyList& keys)
{
   for (auto& [pub, priv] : keys)
      trx.claims.push_back({
          .service = SystemService::VerifyEcSys::service,
          .rawData = psio::convert_to_frac(pub),
      });
   SignedTransaction signedTrx;
   signedTrx.transaction = trx;
   auto hash             = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   for (auto& [pub, priv] : keys)
      signedTrx.proofs.push_back(psio::convert_to_frac(sign(priv, hash)));
   return pushTransaction(signedTrx);
}
