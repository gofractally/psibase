#include <newchain/tester.hpp>

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

std::vector<char> newchain::read_whole_file(std::string_view filename)
{
   std::vector<char> result;
   if (!::read_whole_file(filename.data(), filename.size(), [&](size_t size) {
          result.resize(size);
          return result.data();
       }))
      eosio::check(false, "read " + std::string(filename) + " failed");
   return result;
}

int32_t newchain::execute(std::string_view command)
{
   return ::tester_execute(command.data(), command.size());
}

eosio::asset newchain::string_to_asset(const char* s)
{
   return eosio::convert_from_string<eosio::asset>(s);
}

/**
 * Validates the status of a transaction.  If expected_except is nullptr, then the
 * transaction should succeed.  Otherwise it represents a string which should be
 * part of the error message.
 */
void newchain::expect(const transaction_trace& tt, const char* expected_except)
{
   // TODO
   /*
   if (expected_except)
   {
      if (tt.status == transaction_status::executed)
         eosio::check(false, "transaction succeeded, but was expected to fail with: " +
                                 std::string(expected_except));
      if (!tt.except)
         eosio::check(false, "transaction has no failure message. expected: " +
                                 std::string(expected_except));
      if (tt.except->find(expected_except) == std::string::npos)
         eosio::check(false, "transaction failed with <<<" + *tt.except +
                                 ">>>, but was expected to fail with: <<<" + expected_except +
                                 ">>>");
   }
   else
   {
      if (tt.status == transaction_status::executed)
         return;
      if (tt.except)
         eosio::print("transaction has exception: ", *tt.except, "\n");
      eosio::check(false, "transaction failed with status " + to_string(tt.status));
   }
   */
}

eosio::signature newchain::sign(const eosio::private_key& key, const eosio::checksum256& digest)
{
   auto               raw_digest  = digest.extract_as_byte_array();
   auto               raw_key     = eosio::convert_to_bin(key);
   constexpr uint32_t buffer_size = 80;
   std::vector<char>  buffer(buffer_size);
   unsigned sz = ::tester_sign(raw_key.data(), raw_key.size(), raw_digest.data(), buffer.data(),
                               buffer.size());
   buffer.resize(sz);
   if (sz > buffer_size)
   {
      ::tester_sign(raw_key.data(), raw_key.size(), raw_digest.data(), buffer.data(),
                    buffer.size());
   }
   return eosio::convert_from_bin<eosio::signature>(buffer);
}

void newchain::internal_use_do_not_use::hex(const uint8_t* begin,
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

const eosio::public_key newchain::test_chain::default_pub_key =
    eosio::public_key_from_string("EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV");
const eosio::private_key newchain::test_chain::default_priv_key =
    eosio::private_key_from_string("5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3");

// We only allow one chain to exist at a time in the tester.
// If we ever find that we need multiple chains, this will
// need to be kept in sync with whatever updates the native layer.
static newchain::test_chain* current_chain = nullptr;

newchain::test_chain::test_chain(const char* snapshot, uint64_t state_size)
    : id{::tester_create_chain(snapshot ? snapshot : "",
                               snapshot ? strlen(snapshot) : 0,
                               state_size)}
{
   current_chain = this;
}

newchain::test_chain::~test_chain()
{
   current_chain = nullptr;
   ::tester_destroy_chain(id);
}

void newchain::test_chain::shutdown()
{
   ::tester_shutdown_chain(id);
}

std::string newchain::test_chain::get_path()
{
   size_t      len = tester_get_chain_path(id, nullptr, 0);
   std::string result(len, 0);
   tester_get_chain_path(id, result.data(), len);
   return result;
}

void newchain::test_chain::start_block(int64_t skip_miliseconds)
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

void newchain::test_chain::start_block(std::string_view time)
{
   uint64_t value;
   eosio::check(eosio::string_to_utc_microseconds(value, time.data(), time.data() + time.size()),
                "bad time");
   start_block(eosio::time_point{eosio::microseconds(value)});
}

void newchain::test_chain::start_block(eosio::time_point tp)
{
   finish_block();
   auto head_time = get_head_block_info().time;
   auto skip      = (tp - head_time).count() / 1000 - 500;
   start_block(skip);
}

void newchain::test_chain::finish_block()
{
   head_block_info.reset();
   ::tester_finish_block(id);
}

const newchain::block_info& newchain::test_chain::get_head_block_info()
{
   if (!head_block_info)
   {
      std::vector<char> bin;
      ::get_head_block_info(id, [&](size_t size) {
         bin.resize(size);
         return bin.data();
      });
      head_block_info = eosio::convert_from_bin<block_info>(bin);
   }
   return *head_block_info;
}

void newchain::test_chain::fill_tapos(transaction& t, uint32_t expire_sec)
{
   auto& info      = get_head_block_info();
   t.expiration    = info.time + expire_sec;
   t.ref_block_num = info.num;
   memcpy(&t.ref_block_prefix, info.id.extract_as_byte_array().data() + 8,
          sizeof(t.ref_block_prefix));
}

newchain::transaction newchain::test_chain::make_transaction(std::vector<action>&& actions,
                                                             std::vector<action>&& cfa)
{
   transaction t;
   fill_tapos(t);
   t.actions = std::move(actions);
   return t;
}

[[nodiscard]] newchain::transaction_trace newchain::test_chain::push_transaction(
    const transaction&                     trx,
    const std::vector<eosio::private_key>& keys,
    const std::vector<eosio::signature>&   signatures)
{
   std::vector<char> packed_trx = eosio::convert_to_bin(trx);
   std::vector<char> args;
   eosio::convert_to_bin(packed_trx, args);
   eosio::convert_to_bin(signatures, args);
   eosio::convert_to_bin(keys, args);
   std::vector<char> bin;
   ::push_transaction(id, args.data(), args.size(), [&](size_t size) {
      bin.resize(size);
      return bin.data();
   });
   return eosio::convert_from_bin<transaction_trace>(bin);
}

newchain::transaction_trace newchain::test_chain::transact(
    std::vector<action>&&                  actions,
    const std::vector<eosio::private_key>& keys,
    const char*                            expected_except)
{
   auto trace = push_transaction(make_transaction(std::move(actions)), keys);
   expect(trace, expected_except);
   return trace;
}

newchain::transaction_trace newchain::test_chain::transact(std::vector<action>&& actions,
                                                           const char*           expected_except)
{
   return transact(std::move(actions), {default_priv_key}, expected_except);
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
