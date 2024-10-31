#pragma once

#include <cstdint>
#include <cstring>
#include <psibase/block.hpp>
#include <psio/to_key.hpp>
#include <vector>

namespace psibase::snapshot
{
   struct SnapshotHeader
   {
      std::uint32_t magic   = 0x7388cf00;
      std::uint32_t version = 0;
   };

   constexpr std::uint8_t primaryIndex = 0x0;

   struct StateChecksum
   {
      static constexpr std::uint16_t table = 0;
      auto        key() const { return psio::composite_key(table, primaryIndex); }
      Checksum256 serviceRoot                                            = {};
      Checksum256 nativeRoot                                             = {};
      friend bool operator==(const StateChecksum&, const StateChecksum&) = default;
      PSIO_REFLECT(StateChecksum, serviceRoot, nativeRoot);
   };

   struct StateSignature
   {
      static constexpr std::uint16_t table = 1;
      AccountNumber                  account;
      Claim                          claim;
      std::vector<char>              rawData;
      auto key() const { return psio::composite_key(table, primaryIndex, account); }
      PSIO_REFLECT(StateSignature, account, claim, rawData)
   };

   struct StateSignatureInfo
   {
      StateSignatureInfo(const StateChecksum& info)
      {
         data[0]   = 0x00;
         data[1]   = 0xce;
         data[2]   = 0xa8;
         data[3]   = 'C';
         auto hash = sha256(info);
         std::memcpy(data + 4, hash.data(), hash.size());
      }
      operator std::span<const char>() const { return data; }
      char data[4 + Checksum256{}.size()];
   };

   struct SnapshotFooter
   {
      static constexpr std::uint32_t id = 0xffffffffu;
      std::optional<StateChecksum>   hash;
      std::vector<StateSignature>    signatures;
   };
}  // namespace psibase::snapshot
