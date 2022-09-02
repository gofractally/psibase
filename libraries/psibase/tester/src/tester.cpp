#include <psibase/tester.hpp>

#include <secp256k1.h>
#include <services/system/TransactionSys.hpp>
#include <services/system/VerifyEcSys.hpp>

namespace
{
   using cb_alloc_type = void* (*)(void* cb_alloc_data, size_t size);

   extern "C"
   {
      // TODO: fix naming

      // clang-format off
      [[clang::import_name("testerCreateChain")]]        uint32_t testerCreateChain(uint64_t max_objects, uint64_t hot_addr_bits, uint64_t warm_addr_bits, uint64_t cool_addr_bits, uint64_t cold_addr_bits);
      [[clang::import_name("testerDestroyChain")]]       void     testerDestroyChain(uint32_t chain);
      [[clang::import_name("testerExecute")]]            int32_t  testerExecute(const char* command, uint32_t command_size);
      [[clang::import_name("testerFinishBlock")]]        void     testerFinishBlock(uint32_t chain_index);
      [[clang::import_name("testerGetChainPath")]]       uint32_t testerGetChainPath(uint32_t chain, char* dest, uint32_t dest_size);
      [[clang::import_name("testerPushTransaction")]]    void     testerPushTransaction(uint32_t chain_index, const char* args_packed, uint32_t args_packed_size, void* cb_alloc_data, cb_alloc_type cb_alloc);
      [[clang::import_name("testerReadWholeFile")]]      bool     testerReadWholeFile(const char* filename, uint32_t filename_size, void* cb_alloc_data, cb_alloc_type cb_alloc);
      [[clang::import_name("testerSelectChainForDb")]]   void     testerSelectChainForDb(uint32_t chain_index);
      [[clang::import_name("testerShutdownChain")]]      void     testerShutdownChain(uint32_t chain);
      [[clang::import_name("testerStartBlock")]]         void     testerStartBlock(uint32_t chain_index, int64_t skip_miliseconds);
      // clang-format on
   }

   template <typename Alloc_fn>
   inline bool readWholeFile(const char* filename_begin, uint32_t filename_size, Alloc_fn alloc_fn)
   {
      // TODO: fix memory issue when file not found
      return testerReadWholeFile(filename_begin, filename_size, &alloc_fn,
                                 [](void* cb_alloc_data, size_t size) -> void*
                                 {  //
                                    return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                                 });
   }

   template <typename Alloc_fn>
   inline void pushTransaction(uint32_t    chain,
                               const char* args_begin,
                               uint32_t    args_size,
                               Alloc_fn    alloc_fn)
   {
      testerPushTransaction(chain, args_begin, args_size, &alloc_fn,
                            [](void* cb_alloc_data, size_t size) -> void*
                            {  //
                               return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                            });
   }

   template <typename Alloc_fn>
   inline bool exec_deferred(uint32_t chain, Alloc_fn alloc_fn)
   {
      return tester_exec_deferred(chain, &alloc_fn,
                                  [](void* cb_alloc_data, size_t size) -> void*
                                  {  //
                                     return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                                  });
   }
}  // namespace

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
   std::vector<char> result;
   if (!::readWholeFile(filename.data(), filename.size(),
                        [&](size_t size)
                        {
                           result.resize(size);
                           return result.data();
                        }))
      check(false, "read " + std::string(filename) + " failed");
   return result;
}

int32_t psibase::execute(std::string_view command)
{
   return ::testerExecute(command.data(), command.size());
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

void psibase::internal_use_do_not_use::hex(const uint8_t* begin,
                                           const uint8_t* end,
                                           std::ostream&  os)
{
   std::ostreambuf_iterator<char> dest(os.rdbuf());
   auto                           nibble = [&dest](uint8_t i)
   {
      if (i <= 9)
         *dest++ = '0' + i;
      else
         *dest++ = 'A' + i - 10;
   };
   while (begin != end)
   {
      nibble(((uint8_t)*begin) >> 4);
      nibble(((uint8_t)*begin) & 0xf);
      ++begin;
   }
}

// TODO: change defaults
const psibase::PublicKey psibase::TestChain::defaultPubKey =
    psibase::publicKeyFromString("PUB_K1_8UUMcamEE6dnK4kyrSPnAEAPTWZduZtE9SuFvURr3UjGDpF9LX");
const psibase::PrivateKey psibase::TestChain::defaultPrivKey =
    psibase::privateKeyFromString("PVT_K1_27Hseiioosmff4ue31Jv37pC1NWfhbjuKuSBxEkqCTzbJtxQD2");

// We only allow one chain to exist at a time in the tester.
// If we ever find that we need multiple chains, this will
// need to be kept in sync with whatever updates the native layer.
static psibase::TestChain* currentChain = nullptr;

psibase::TestChain::TestChain(uint64_t max_objects,
                              uint64_t hot_addr_bits,
                              uint64_t warm_addr_bits,
                              uint64_t cool_addr_bits,
                              uint64_t cold_addr_bits)
    : id{::testerCreateChain(max_objects,
                             hot_addr_bits,
                             warm_addr_bits,
                             cool_addr_bits,
                             cold_addr_bits)}
{
   currentChain = this;
}

psibase::TestChain::~TestChain()
{
   currentChain = nullptr;
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

void psibase::TestChain::startBlock(int64_t skip_miliseconds)
{
   headBlockInfo.reset();
   if (skip_miliseconds >= 500)
   {
      // Guarantee that there is a recent block for fillTapos to use.
      ::testerStartBlock(id, skip_miliseconds - 500);
      ::testerStartBlock(id, 0);
   }
   else
   {
      ::testerStartBlock(id, skip_miliseconds);
   }
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
   finishBlock();
   auto head_time = getHeadBlockInfo().header.time;
   // auto skip      = (tp - head_time).count() / 1000 - 500;
   auto skip = tp.seconds - head_time.seconds;
   startBlock(skip);
}

void psibase::TestChain::finishBlock()
{
   headBlockInfo.reset();
   ::testerFinishBlock(id);
}

const psibase::BlockInfo& psibase::TestChain::getHeadBlockInfo()
{
   if (!headBlockInfo)
   {
      if (auto status = system_contract::getOptionalStatus())
         headBlockInfo = status->head;
   }
   return *headBlockInfo;
}

void psibase::TestChain::fillTapos(Transaction& t, uint32_t expire_sec)
{
   auto& info                 = getHeadBlockInfo();
   t.tapos.expiration.seconds = info.header.time.seconds + expire_sec;
   auto [index, suffix]       = system_contract::headTapos();
   t.tapos.refBlockIndex      = index;
   t.tapos.refBlockSuffix     = suffix;
}

psibase::Transaction psibase::TestChain::makeTransaction(std::vector<Action>&& actions)
{
   Transaction t;
   fillTapos(t);
   t.actions = std::move(actions);
   return t;
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(
    const SignedTransaction& signedTrx)
{
   std::vector<char> packed_trx = psio::convert_to_frac(signedTrx);
   std::vector<char> bin;
   ::pushTransaction(id, packed_trx.data(), packed_trx.size(),
                     [&](size_t size)
                     {
                        bin.resize(size);
                        return bin.data();
                     });
   return psio::convert_from_frac<TransactionTrace>(bin);
}

[[nodiscard]] psibase::TransactionTrace psibase::TestChain::pushTransaction(
    Transaction                                          trx,
    const std::vector<std::pair<PublicKey, PrivateKey>>& keys)
{
   for (auto& [pub, priv] : keys)
      trx.claims.push_back({
          .contract = system_contract::VerifyEcSys::service,
          .rawData  = psio::convert_to_frac(pub),
      });
   SignedTransaction signedTrx;
   signedTrx.transaction = trx;
   auto hash             = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   for (auto& [pub, priv] : keys)
      signedTrx.proofs.push_back(psio::convert_to_frac(sign(priv, hash)));
   return pushTransaction(signedTrx);
}

psibase::TransactionTrace psibase::TestChain::transact(
    std::vector<Action>&&                                actions,
    const std::vector<std::pair<PublicKey, PrivateKey>>& keys,
    const char*                                          expectedExcept)
{
   auto trace = pushTransaction(makeTransaction(std::move(actions)), keys);
   expect(trace, expectedExcept);
   return trace;
}

psibase::TransactionTrace psibase::TestChain::transact(std::vector<Action>&& actions,
                                                       const char*           expectedExcept)
{
   return transact(std::move(actions), {{defaultPubKey, defaultPrivKey}}, expectedExcept);
}
