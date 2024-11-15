#pragma once

#include <cstddef>
#include <cstdint>
#include <psibase/crypto.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   struct DatabaseConfig;
}

namespace psibase::tester::raw
{

#define TESTER_NATIVE(name) [[clang::import_module("psibase"), clang::import_name(#name)]]

   TESTER_NATIVE(openChain)
   std::uint32_t openChain(const char*                    path,
                           std::uint32_t                  pathlen,
                           std::uint16_t                  oflags,
                           std::uint64_t                  fs_rights_base,
                           const psibase::DatabaseConfig* config);

   TESTER_NATIVE(createChain)
   std::uint32_t createChain(std::uint64_t hot_addr_bits,
                             std::uint64_t warm_addr_bits,
                             std::uint64_t cool_addr_bits,
                             std::uint64_t cold_addr_bits);
   TESTER_NATIVE(cloneChain) std::uint32_t cloneChain(std::uint32_t chain);
   TESTER_NATIVE(getFork) void getFork(std::uint32_t chain, const psibase::Checksum256& id);
   TESTER_NATIVE(destroyChain) void destroyChain(std::uint32_t chain);
   TESTER_NATIVE(finishBlock) void finishBlock(std::uint32_t chain_index);
   TESTER_NATIVE(verify)
   std::uint32_t verify(std::uint32_t chain_index,
                        const char*   args_packed,
                        std::uint32_t args_packed_size);
   TESTER_NATIVE(pushTransaction)
   std::uint32_t pushTransaction(std::uint32_t chain_index,
                                 const char*   args_packed,
                                 std::uint32_t args_packed_size);
   TESTER_NATIVE(httpRequest)
   std::uint32_t httpRequest(std::uint32_t chain_index,
                             const char*   args_packed,
                             std::uint32_t args_packed_size);
   TESTER_NATIVE(socketRecv) std::uint32_t socketRecv(std::int32_t fd, std::size_t* size);
   TESTER_NATIVE(shutdownChain) void shutdownChain(uint32_t chain);
   TESTER_NATIVE(startBlock) void startBlock(std::uint32_t chain_index, std::uint32_t time_seconds);

   TESTER_NATIVE(abortMessage) void abortMessage(const char* message, std::uint32_t len);

   TESTER_NATIVE(getResult)
   std::uint32_t getResult(const char* dest, std::uint32_t destSize, std::uint32_t offset);

   TESTER_NATIVE(getKey) std::uint32_t getKey(const char* dest, std::uint32_t destSize);

   TESTER_NATIVE(kvGet)
   std::uint32_t kvGet(std::uint32_t chain, DbId db, const char* key, std::uint32_t keyLen);

   TESTER_NATIVE(getSequential)
   std::uint32_t getSequential(std::uint32_t chain, DbId db, std::uint64_t id);

   TESTER_NATIVE(kvGreaterEqual)
   std::uint32_t kvGreaterEqual(std::uint32_t chain,
                                DbId          db,
                                const char*   key,
                                std::uint32_t keyLen,
                                std::uint32_t matchKeySize);

   TESTER_NATIVE(kvLessThan)
   std::uint32_t kvLessThan(std::uint32_t chain,
                            DbId          db,
                            const char*   key,
                            std::uint32_t keyLen,
                            std::uint32_t matchKeySize);

   TESTER_NATIVE(kvMax)
   std::uint32_t kvMax(std::uint32_t chain, DbId db, const char* key, std::uint32_t keyLen);

   TESTER_NATIVE(kvPut)
   void kvPut(std::uint32_t chain,
              psibase::DbId db,
              const char*   key,
              std::uint32_t keyLen,
              const char*   value,
              std::uint32_t valueLen);

   TESTER_NATIVE(kvRemove)
   void kvRemove(std::uint32_t chain, psibase::DbId db, const char* key, std::uint32_t keyLen);

   TESTER_NATIVE(checkoutSubjective) void checkoutSubjective(std::uint32_t chain);
   TESTER_NATIVE(commitSubjective) bool commitSubjective(std::uint32_t chain);
   TESTER_NATIVE(abortSubjective) void abortSubjective(std::uint32_t chain);

   TESTER_NATIVE(commitState)
   void commitState(std::uint32_t chain);

#undef TESTER_NATIVE

}  // namespace psibase::tester::raw
