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

   using EccPublicKey = std::array<uint8_t, 33>;
   struct PublicKey
   {
      using variant_type = std::variant<EccPublicKey, EccPublicKey>;  // k1, r1
      variant_type data;

      bool operator==(const PublicKey& other) const { return data == other.data; }
   };
   PSIO_REFLECT(PublicKey, definitionWillNotChange(), data)

   using EccPrivateKey = std::array<uint8_t, 32>;
   struct PrivateKey
   {
      using variant_type = std::variant<EccPrivateKey, EccPrivateKey>;  // k1, r1
      variant_type data;
   };
   PSIO_REFLECT(PrivateKey, definitionWillNotChange(), data)

   using EccSignature = std::array<uint8_t, 64>;
   struct Signature
   {
      using variant_type = std::variant<EccSignature, EccSignature>;  // k1, r1
      variant_type data;
   };
   PSIO_REFLECT(Signature, definitionWillNotChange(), data)

   std::string publicKeyToString(const PublicKey& obj);
   PublicKey   publicKeyFromString(std::string_view s);
   std::string privateKeyToString(const PrivateKey& obj);
   PrivateKey  privateKeyFromString(std::string_view s);
   std::string signatureToString(const Signature& obj);
   Signature   signatureFromString(std::string_view s);

   template <typename S>
   void to_json(const PublicKey& obj, S& stream)
   {
      to_json(publicKeyToString(obj), stream);
   }
   template <typename S>
   void from_json(PublicKey& obj, S& stream)
   {
      auto s = stream.get_string();
      obj    = publicKeyFromString(s);
   }
   inline constexpr bool use_json_string_for_gql(PublicKey*)
   {
      return true;
   }

   template <typename S>
   void to_json(const PrivateKey& obj, S& stream)
   {
      to_json(privateKeyToString(obj), stream);
   }
   template <typename S>
   void from_json(PrivateKey& obj, S& stream)
   {
      obj = privateKeyFromString(stream.get_string());
   }
   inline constexpr bool use_json_string_for_gql(PrivateKey*)
   {
      return true;
   }

   template <typename S>
   void to_json(const Signature& obj, S& stream)
   {
      return to_json(signatureToString(obj), stream);
   }
   template <typename S>
   void from_json(Signature& obj, S& stream)
   {
      obj = signatureFromString(stream.get_string());
   }
   inline constexpr bool use_json_string_for_gql(Signature*)
   {
      return true;
   }

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
      void push_impl(const Checksum256& hash);
   };
   PSIO_REFLECT(Merkle, i, stack)

}  // namespace psibase
