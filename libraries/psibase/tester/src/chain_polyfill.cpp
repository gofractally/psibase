#include <psibase/api.hpp>
#include <psibase/testerApi.hpp>

using namespace psibase;
using std::uint32_t;

namespace psibase::tester::raw
{
   extern uint32_t getSelectedChain();
}  // namespace psibase::tester::raw

uint32_t psibase::raw::getResult(const char* dest, uint32_t destSize, uint32_t offset)
{
   return psibase::tester::raw::getResult(dest, destSize, offset);
}

uint32_t psibase::raw::getKey(const char* dest, uint32_t destSize)
{
   return psibase::tester::raw::getKey(dest, destSize);
}

void psibase::raw::abortMessage(const char* message, uint32_t len)
{
   psibase::tester::raw::abortMessage(message, len);
}

void psibase::raw::writeConsole(const char* message, uint32_t len)
{
   ::write(1, message, len);
}

std::uint32_t psibase::raw::getCurrentAction()
{
   psibase::abortMessage("Tester does not support getCurrentAction");
}

std::uint32_t psibase::raw::call(const char* action, std::uint32_t len, CallFlags flags)
{
   psibase::abortMessage("Tester does not support call");
}

void psibase::raw::setRetval(const char* retval, std::uint32_t len)
{
   psibase::abortMessage("Tester does not support setRetval");
}

// PSIBASE_NATIVE(putSequential)
// uint64_t putSequential(DbId db, const char* value, uint32_t valueLen);

struct KvBucket
{
   DbId              db;
   std::vector<char> prefix;
   KvMode            mode;
   std::vector<char> key(const char* key, uint32_t len) const
   {
      std::vector<char> result;
      result.reserve(prefix.size() + len);
      result.insert(result.end(), prefix.begin(), prefix.end());
      result.insert(result.end(), key, key + len);
      return result;
   }
   KvHandle handle() const { return static_cast<KvHandle>(reinterpret_cast<std::uintptr_t>(this)); }
   static const KvBucket* from(KvHandle handle)
   {
      return reinterpret_cast<const KvBucket*>(static_cast<std::uintptr_t>(handle));
   }
};

KvHandle psibase::raw::kvOpen(DbId db, const char* prefix, uint32_t len, KvMode mode)
{
   return (new KvBucket{.db = db, .prefix{prefix, prefix + len}, .mode = mode})->handle();
}

KvHandle psibase::raw::kvOpenAt(KvHandle handle, const char* prefix, uint32_t len, KvMode mode)
{
   auto src = KvBucket::from(handle);
   return (new KvBucket{.db = src->db, .prefix = src->key(prefix, len), .mode = mode})->handle();
}

void psibase::raw::kvClose(KvHandle handle)
{
   delete KvBucket::from(handle);
}

uint32_t psibase::raw::kvGet(KvHandle db, const char* key, uint32_t keyLen)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   return psibase::tester::raw::kvGet(psibase::tester::raw::getSelectedChain(), bucket->db,
                                      fullKey.data(), fullKey.size());
}

uint32_t psibase::raw::getSequential(DbId db, uint64_t id)
{
   return psibase::tester::raw::getSequential(psibase::tester::raw::getSelectedChain(), db, id);
}

uint32_t psibase::raw::kvGreaterEqual(KvHandle    db,
                                      const char* key,
                                      uint32_t    keyLen,
                                      uint32_t    matchKeySize)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   return psibase::tester::raw::kvGreaterEqual(psibase::tester::raw::getSelectedChain(), bucket->db,
                                               fullKey.data(), fullKey.size(),
                                               bucket->prefix.size() + matchKeySize);
}

uint32_t psibase::raw::kvLessThan(KvHandle    db,
                                  const char* key,
                                  uint32_t    keyLen,
                                  uint32_t    matchKeySize)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   return psibase::tester::raw::kvLessThan(psibase::tester::raw::getSelectedChain(), bucket->db,
                                           fullKey.data(), fullKey.size(),
                                           bucket->prefix.size() + matchKeySize);
}

uint32_t psibase::raw::kvMax(KvHandle db, const char* key, uint32_t keyLen)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   return psibase::tester::raw::kvMax(psibase::tester::raw::getSelectedChain(), bucket->db,
                                      fullKey.data(), fullKey.size());
}

void psibase::raw::kvPut(KvHandle    db,
                         const char* key,
                         uint32_t    keyLen,
                         const char* value,
                         uint32_t    valueLen)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   psibase::tester::raw::kvPut(psibase::tester::raw::getSelectedChain(), bucket->db, fullKey.data(),
                               fullKey.size(), value, valueLen);
}

void psibase::raw::kvRemove(KvHandle db, const char* key, uint32_t keyLen)
{
   const auto* bucket  = KvBucket::from(db);
   auto        fullKey = bucket->key(key, keyLen);
   psibase::tester::raw::kvRemove(psibase::tester::raw::getSelectedChain(), bucket->db,
                                  fullKey.data(), fullKey.size());
}

std::int32_t psibase::raw::socketSend(std::int32_t fd, const void* data, std::size_t size)
{
   psibase::abortMessage("Tester does not support socketSend");
}

// PSIBASE_NATIVE(setMaxTransactionTime) void setMaxTransactionTime(uint64_t ns);

void psibase::raw::checkoutSubjective()
{
   psibase::tester::raw::checkoutSubjective(psibase::tester::raw::getSelectedChain());
}

bool psibase::raw::commitSubjective()
{
   return psibase::tester::raw::commitSubjective(psibase::tester::raw::getSelectedChain());
}

void psibase::raw::abortSubjective()
{
   return psibase::tester::raw::abortSubjective(psibase::tester::raw::getSelectedChain());
}

AccountNumber psibase::internal::sender;
AccountNumber psibase::internal::receiver;
