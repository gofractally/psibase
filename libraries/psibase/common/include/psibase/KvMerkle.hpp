#pragma once

#include <psibase/check.hpp>
#include <psibase/crypto.hpp>
#include <span>
#include <vector>

namespace psibase
{

   // This class represents a merkle root for a key-value database
   //
   // The leaf node for each key-value pair is
   // sha256(00 || key length (32-bit unsigned little endian) || key || value length ((32-bit unsigned little endian)) || value)
   //
   // Each inner node is
   // sha256(01 || lhs || rhs)
   //
   // Subtrees are combined in pairs based on key. There are two kinds of nodes
   // - The node for the subtree (b0, b1, ..., bn, 0) is combined with the node for the subtree (b0, b1, ..., bn, 1) if both exist.
   // - The leaf node for a key is combined with the node for all other keys that have it as a prefix if both exist.
   struct KvMerkle
   {
      struct Item
      {
         Item();
         Item(std::span<const unsigned char> key, std::span<const unsigned char> value);
         void                           fromStream(auto& stream);
         void                           fromResult(std::uint32_t valueSize);
         void                           nextKey();
         std::span<const unsigned char> key() const;
         std::span<const unsigned char> value() const;
         Checksum256                    get_hash() const;
         std::vector<unsigned char>     data;
      };
      // The stack contains:
      // - for i in 0..current_key.size()
      //   - leaf at current_key[..i]
      //   - previous subtrees for each non-zero bit of current_key[i]
      // - leaf at current_key
      //
      // An empty stack is a special case which represents the initial state.
      std::vector<Checksum256>   stack;
      std::vector<unsigned char> current_key;
      Checksum256                root() &&;
      void                       push(const Item& item);
      void               push_hash(std::span<const unsigned char> key, const Checksum256& value);
      static Checksum256 combine(const Checksum256& lhs, const Checksum256& rhs);
      void               pop_n(std::size_t n);
   };

   void KvMerkle::Item::fromStream(auto& stream)
   {
      auto do_read = [&](void* out, std::size_t n)
      {
         if (!stream.read(reinterpret_cast<char*>(out), n))
         {
            abortMessage("read");
         }
      };
      std::uint32_t keySize;
      std::uint32_t valueSize;
      do_read(&keySize, 4);
      data.resize(5 + keySize);
      std::memcpy(data.data() + 1, &keySize, 4);
      do_read(data.data() + 5, keySize);
      do_read(&valueSize, 4);
      data.resize(9 + keySize + valueSize);
      std::memcpy(data.data() + 5 + keySize, &valueSize, 4);
      do_read(data.data() + 9 + keySize, valueSize);
   }
}  // namespace psibase
