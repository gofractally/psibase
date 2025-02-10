#pragma once

#include <psio/fracpack.hpp>

namespace psibase
{
   using Checksum160 = std::array<uint8_t, 20>;
   using Checksum256 = std::array<uint8_t, 32>;
   using Checksum512 = std::array<uint8_t, 64>;

   Checksum256 sha256(const char* data, size_t length);

   inline Checksum256 sha256(const unsigned char* data, size_t length)
   {
      return sha256(reinterpret_cast<const char*>(data), length);
   }

   template <typename T>
   Checksum256 sha256(const T& obj)
   {
      auto bin = psio::to_frac(obj);
      return sha256(bin.data(), bin.size());
   }

   Checksum256 hmacSha256(const char* key,
                          std::size_t keyLen,
                          const char* data,
                          std::size_t dataLen);

   Checksum256 hmacSha256(std::span<const char> key, std::span<const char> data);

   // The Merkle class incrementally constructs a merkle tree
   //
   // An empty tree is represented by the zero hash
   // A leaf node is sha256(00 || frac(value))
   // An internal node is sha256(01 || lhs || rhs)
   //
   // The tree has the minimum depth for a given number of elements, and left
   // subtrees are filled first.
   //
   //  /\       /\     / \         /\
   // 1  2     /\ 3   /   \       /  5
   //         1 2    /\   /\     / \
   //               1  2 3  4   /   \
   //                          /\   /\
   //                         1  2 3  4
   struct Merkle
   {
      std::uint64_t            i = 0;
      std::vector<Checksum256> stack;
      // Returns the root of all the nodes that have been inserted so far
      Checksum256 root() const;
      // Appends a leaf node at the right edge of the tree
      template <typename T>
      void push(const T& value)
      {
         push_impl(hash_leaf(value));
      }
      template <typename T>
      static Checksum256 hash_leaf(const T& value)
      {
         std::vector<char>   result{'\0'};
         psio::vector_stream stream{result};
         psio::to_frac(value, stream);
         return sha256(result.data(), result.size());
      }

      static Checksum256 combine(const Checksum256& lhs, const Checksum256& rhs);
      void               push_impl(const Checksum256& hash);
      PSIO_REFLECT(Merkle, i, stack)
   };

}  // namespace psibase
