#include <psibase/tester.hpp>

#include <secp256k1.h>
#include <contracts/system/verify_ec_sys.hpp>
#include <eosio/abi.hpp>
#include <eosio/authority.hpp>
#include <eosio/from_string.hpp>

namespace
{
   using cb_alloc_type = void* (*)(void* cb_alloc_data, size_t size);

   extern "C"
   {
      // clang-format off
      [[clang::import_name("tester_create_chain")]]                uint32_t tester_create_chain(const char* snapshot, uint32_t snapshot_size, uint64_t state_size);
      [[clang::import_name("tester_destroy_chain")]]               void     tester_destroy_chain(uint32_t chain);
      [[clang::import_name("tester_execute")]]                     int32_t  tester_execute(const char* command, uint32_t command_size);
      [[clang::import_name("tester_finish_block")]]                void     tester_finish_block(uint32_t chain_index);
      [[clang::import_name("tester_get_chain_path")]]              uint32_t tester_get_chain_path(uint32_t chain, char* dest, uint32_t dest_size);
      [[clang::import_name("tester_get_head_block_info")]]         void     tester_get_head_block_info(uint32_t chain_index, void* cb_alloc_data, cb_alloc_type cb_alloc);
      [[clang::import_name("tester_push_transaction")]]            void     tester_push_transaction(uint32_t chain_index, const char* args_packed, uint32_t args_packed_size, void* cb_alloc_data, cb_alloc_type cb_alloc);
      [[clang::import_name("tester_read_whole_file")]]             bool     tester_read_whole_file(const char* filename, uint32_t filename_size, void* cb_alloc_data, cb_alloc_type cb_alloc);
      [[clang::import_name("tester_select_chain_for_db")]]         void     tester_select_chain_for_db(uint32_t chain_index);
      [[clang::import_name("tester_shutdown_chain")]]              void     tester_shutdown_chain(uint32_t chain);
      [[clang::import_name("tester_sign")]]                        uint32_t tester_sign(const void* key, uint32_t keylen, const void* digest, void* sig, uint32_t siglen);
      [[clang::import_name("tester_start_block")]]                 void     tester_start_block(uint32_t chain_index, int64_t skip_miliseconds);
      // clang-format on
   }

   template <typename Alloc_fn>
   inline bool read_whole_file(const char* filename_begin,
                               uint32_t    filename_size,
                               Alloc_fn    alloc_fn)
   {
      return tester_read_whole_file(filename_begin, filename_size, &alloc_fn,
                                    [](void* cb_alloc_data, size_t size) -> void* {  //
                                       return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                                    });
   }

   template <typename Alloc_fn>
   inline void get_head_block_info(uint32_t chain, Alloc_fn alloc_fn)
   {
      tester_get_head_block_info(chain, &alloc_fn,
                                 [](void* cb_alloc_data, size_t size) -> void* {  //
                                    return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                                 });
   }

   template <typename Alloc_fn>
   inline void push_transaction(uint32_t    chain,
                                const char* args_begin,
                                uint32_t    args_size,
                                Alloc_fn    alloc_fn)
   {
      tester_push_transaction(chain, args_begin, args_size, &alloc_fn,
                              [](void* cb_alloc_data, size_t size) -> void* {  //
                                 return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                              });
   }

   template <typename Alloc_fn>
   inline bool exec_deferred(uint32_t chain, Alloc_fn alloc_fn)
   {
      return tester_exec_deferred(chain, &alloc_fn,
                                  [](void* cb_alloc_data, size_t size) -> void* {  //
                                     return (*reinterpret_cast<Alloc_fn*>(cb_alloc_data))(size);
                                  });
   }
}  // namespace

psibase::TraceResult::TraceResult(transaction_trace&& t) : _t(t) {}

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

bool psibase::TraceResult::diskConsumed(
    const std::vector<std::pair<AccountNumber, int64_t>>& consumption)
{
   //const vector<action_trace>& actions = trace.action_traces;
   //const auto& ram_deltas = actions.at(0).account_ram_deltas;

   {
       //INFO("Check for equality in the total number of RAM changes");
       //CHECK(ram_deltas.size() == consumption.size());
   }

   {
      //INFO("Check that each actual RAM delta was in the set of expected deltas");
      // for (const auto& delta : ram_deltas)
      // {
      //    bool foundMatch =
      //        std::any_of(consumption.begin(), consumption.end(), [&](const auto& cPair) {
      //           return cPair.first == delta.account && cPair.second == delta.delta;
      //        });
      //    if (!foundMatch)
      //    {
      //       INFO("Real RAM Delta: [" << delta.account.to_string() << "]["
      //                                << std::to_string(delta.delta) << "]");
      //       CHECK(false);
      //    }
      // }
   }

   return true;
}

std::vector<char> psibase::read_whole_file(std::string_view filename)
{
   std::vector<char> result;
   if (!::read_whole_file(filename.data(), filename.size(), [&](size_t size) {
          result.resize(size);
          return result.data();
       }))
      eosio::check(false, "read " + std::string(filename) + " failed");
   return result;
}

int32_t psibase::execute(std::string_view command)
{
   return ::tester_execute(command.data(), command.size());
}

eosio::asset psibase::string_to_asset(const char* s)
{
   return eosio::convert_from_string<eosio::asset>(s);
}

void psibase::expect(transaction_trace t, const std::string& expected, bool always_show)
{
   std::string error = t.error ? *t.error : "";
   bool bad = (expected.empty() && !error.empty()) || error.find(expected) == std::string::npos;
   if (bad || always_show)
      std::cout << pretty_trace(trim_raw_data(std::move(t))) << "\n";
   if (bad)
   {
      if (expected.empty())
         eosio::check(false, "transaction failed");
      else
         eosio::check(false, "transaction was expected to fail with " + expected);
   }
}

psibase::Signature psibase::sign(const PrivateKey& key, const Checksum256& digest)
{
   static auto context = secp256k1_context_create(SECP256K1_CONTEXT_SIGN);
   auto*       k1      = std::get_if<0>(&key);
   eosio::check(k1, "only k1 currently supported");

   secp256k1_ecdsa_signature sig;
   eosio::check(
       secp256k1_ecdsa_sign(context, &sig, reinterpret_cast<const unsigned char*>(digest.data()),
                            k1->data(), nullptr, nullptr) == 1,
       "sign failed");

   EccSignature sigdata;
   eosio::check(secp256k1_ecdsa_signature_serialize_compact(context, sigdata.data(), &sig) == 1,
                "serialize signature failed");
   return Signature{std::in_place_index<0>, sigdata};
}

void psibase::internal_use_do_not_use::hex(const uint8_t* begin,
                                           const uint8_t* end,
                                           std::ostream&  os)
{
   std::ostreambuf_iterator<char> dest(os.rdbuf());
   auto                           nibble = [&dest](uint8_t i) {
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
const psibase::PublicKey psibase::test_chain::default_pub_key =
    psibase::publicKeyFromString("EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV");
const psibase::PrivateKey psibase::test_chain::default_priv_key =
    psibase::privateKeyFromString("5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3");

// We only allow one chain to exist at a time in the tester.
// If we ever find that we need multiple chains, this will
// need to be kept in sync with whatever updates the native layer.
static psibase::test_chain* current_chain = nullptr;

psibase::test_chain::test_chain(const char* snapshot, uint64_t state_size)
    : id{::tester_create_chain(snapshot ? snapshot : "",
                               snapshot ? strlen(snapshot) : 0,
                               state_size)}
{
   current_chain = this;
}

psibase::test_chain::~test_chain()
{
   current_chain = nullptr;
   ::tester_destroy_chain(id);
}

void psibase::test_chain::shutdown()
{
   ::tester_shutdown_chain(id);
}

std::string psibase::test_chain::get_path()
{
   size_t      len = tester_get_chain_path(id, nullptr, 0);
   std::string result(len, 0);
   tester_get_chain_path(id, result.data(), len);
   return result;
}

void psibase::test_chain::start_block(int64_t skip_miliseconds)
{
   head_block_info.reset();
   if (skip_miliseconds >= 500)
   {
      // Guarantee that there is a recent block for fill_tapos to use.
      ::tester_start_block(id, skip_miliseconds - 500);
      ::tester_start_block(id, 0);
   }
   else
   {
      ::tester_start_block(id, skip_miliseconds);
   }
}

void psibase::test_chain::start_block(std::string_view time)
{
   uint64_t value;
   eosio::check(eosio::string_to_utc_microseconds(value, time.data(), time.data() + time.size()),
                "bad time");
   start_block(TimePointSec{.seconds = uint32_t(value / 1000)});
}

void psibase::test_chain::start_block(TimePointSec tp)
{
   finish_block();
   auto head_time = get_head_block_info().header.time;
   // auto skip      = (tp - head_time).count() / 1000 - 500;
   auto skip = tp.seconds - head_time.seconds;
   start_block(skip);
}

void psibase::test_chain::finish_block()
{
   head_block_info.reset();
   ::tester_finish_block(id);
}

const psibase::block_info& psibase::test_chain::get_head_block_info()
{
   if (!head_block_info)
   {
      std::vector<char> bin;
      ::get_head_block_info(id, [&](size_t size) {
         bin.resize(size);
         return bin.data();
      });
      head_block_info = psio::convert_from_frac<block_info>(bin);
   }
   return *head_block_info;
}

void psibase::test_chain::fill_tapos(transaction& t, uint32_t expire_sec)
{
   auto& info                 = get_head_block_info();
   t.tapos.expiration.seconds = info.header.time.seconds + expire_sec;
   t.tapos.ref_block_num      = info.header.num;
   memcpy(&t.tapos.ref_block_prefix, (char*)info.id.data() + 8, sizeof(t.tapos.ref_block_prefix));
}

psibase::transaction psibase::test_chain::make_transaction(std::vector<action>&& actions)
{
   transaction t;
   fill_tapos(t);
   t.actions = std::move(actions);
   return t;
}

[[nodiscard]] psibase::transaction_trace psibase::test_chain::push_transaction(
    const signed_transaction& signed_trx)
{
   std::vector<char> packed_trx = psio::convert_to_frac(signed_trx);
   std::vector<char> bin;
   ::push_transaction(id, packed_trx.data(), packed_trx.size(), [&](size_t size) {
      bin.resize(size);
      return bin.data();
   });
   return psio::convert_from_frac<transaction_trace>(bin);
}

[[nodiscard]] psibase::transaction_trace psibase::test_chain::push_transaction(
    const transaction&                                   trx,
    const std::vector<std::pair<PublicKey, PrivateKey>>& keys)
{
   signed_transaction signed_trx;
   signed_trx.trx = trx;
   for (auto& [pub, priv] : keys)
      signed_trx.trx.claims.push_back({
          .contract = system_contract::verify_ec_sys::contract,
          .raw_data = psio::convert_to_frac(pub),
      });
   // TODO: don't pack twice
   std::vector<char> packed_trx = psio::convert_to_frac(signed_trx.trx);
   auto              hash       = sha256(packed_trx.data(), packed_trx.size());
   for (auto& [pub, priv] : keys)
      signed_trx.proofs.push_back(psio::convert_to_frac(sign(priv, hash)));
   return push_transaction(signed_trx);
}

psibase::transaction_trace psibase::test_chain::transact(
    std::vector<action>&&                                actions,
    const std::vector<std::pair<PublicKey, PrivateKey>>& keys,
    const char*                                          expected_except)
{
   auto trace = push_transaction(make_transaction(std::move(actions)), keys);
   expect(trace, expected_except);
   return trace;
}

psibase::transaction_trace psibase::test_chain::transact(std::vector<action>&& actions,
                                                         const char*           expected_except)
{
   return transact(std::move(actions), {{default_pub_key, default_priv_key}}, expected_except);
}

std::ostream& eosio::operator<<(std::ostream& os, const eosio::time_point_sec& obj)
{
   return os << eosio::microseconds_to_str(uint64_t(obj.utc_seconds) * 1'000'000);
}

std::ostream& eosio::operator<<(std::ostream& os, const eosio::name& obj)
{
   return os << obj.to_string();
}

std::ostream& eosio::operator<<(std::ostream& os, const eosio::asset& obj)
{
   return os << obj.to_string();
}
