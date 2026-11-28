#pragma once

// The parts of the IPFS data formats that the node's file store needs:
// content ids (CIDv1, sha2-256), the dag-pb node, and the UnixFS record
// inside it. Parsing and formatting only; nothing here touches storage.
//
// A block is identified by the hash of its bytes. A file is one raw block,
// or a dag-pb node whose links are its parts in order. A directory is a
// dag-pb node whose links are its entries by name.

#include <cstdint>
#include <optional>
#include <psibase/crypto.hpp>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace LocalService::ipfs
{
   inline constexpr std::uint64_t codecRaw   = 0x55;
   inline constexpr std::uint64_t codecDagPb = 0x70;
   inline constexpr std::uint64_t hashSha256 = 0x12;

   using ByteView = std::span<const unsigned char>;

   struct Cid
   {
      std::uint64_t        codec = codecRaw;
      psibase::Checksum256 digest{};
      friend bool          operator==(const Cid&, const Cid&) = default;
   };

   // Unsigned LEB128, as multiformats and protobuf use it. Advances `in`.
   inline std::optional<std::uint64_t> readVarint(ByteView& in)
   {
      std::uint64_t result = 0;
      for (unsigned shift = 0; shift < 64; shift += 7)
      {
         if (in.empty())
            return std::nullopt;
         auto b = in.front();
         in     = in.subspan(1);
         result |= std::uint64_t(b & 0x7f) << shift;
         if (!(b & 0x80))
            return result;
      }
      return std::nullopt;
   }

   inline void writeVarint(std::vector<unsigned char>& out, std::uint64_t value)
   {
      while (value >= 0x80)
      {
         out.push_back(static_cast<unsigned char>(value) | 0x80);
         value >>= 7;
      }
      out.push_back(static_cast<unsigned char>(value));
   }

   // The binary form: version 1, codec, sha2-256, 32, digest.
   inline std::optional<Cid> parseCidBytes(ByteView in)
   {
      auto version = readVarint(in);
      if (!version || *version != 1)
         return std::nullopt;
      auto codec = readVarint(in);
      if (!codec || (*codec != codecRaw && *codec != codecDagPb))
         return std::nullopt;
      auto hash = readVarint(in);
      auto size = readVarint(in);
      if (!hash || *hash != hashSha256 || !size || *size != 32 || in.size() != 32)
         return std::nullopt;
      Cid result{.codec = *codec};
      std::copy(in.begin(), in.end(), result.digest.begin());
      return result;
   }

   inline std::vector<unsigned char> cidBytes(const Cid& cid)
   {
      std::vector<unsigned char> out;
      writeVarint(out, 1);
      writeVarint(out, cid.codec);
      writeVarint(out, hashSha256);
      writeVarint(out, 32);
      out.insert(out.end(), cid.digest.begin(), cid.digest.end());
      return out;
   }

   inline constexpr std::string_view base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

   // The text form: multibase "b" (base32, lower case, no padding).
   inline std::string cidToString(const Cid& cid)
   {
      auto        bytes = cidBytes(cid);
      std::string out   = "b";
      unsigned    acc = 0, bits = 0;
      for (auto b : bytes)
      {
         acc = (acc << 8) | b;
         bits += 8;
         while (bits >= 5)
         {
            out += base32Alphabet[(acc >> (bits - 5)) & 31];
            bits -= 5;
         }
      }
      if (bits)
         out += base32Alphabet[(acc << (5 - bits)) & 31];
      return out;
   }

   inline std::optional<Cid> parseCid(std::string_view text)
   {
      if (text.size() < 2 || text[0] != 'b')
         return std::nullopt;
      std::vector<unsigned char> bytes;
      unsigned                   acc = 0, bits = 0;
      for (char ch : text.substr(1))
      {
         auto pos = base32Alphabet.find(ch);
         if (pos == std::string_view::npos)
            return std::nullopt;
         acc = (acc << 5) | static_cast<unsigned>(pos);
         bits += 5;
         if (bits >= 8)
         {
            bytes.push_back(static_cast<unsigned char>(acc >> (bits - 8)));
            bits -= 8;
         }
      }
      // Leftover bits must be padding zeros.
      if (bits >= 5 || (acc & ((1u << bits) - 1)) != 0)
         return std::nullopt;
      auto cid = parseCidBytes(bytes);
      // One text per id: refuse anything that does not format back the same.
      if (!cid || cidToString(*cid) != text)
         return std::nullopt;
      return cid;
   }

   // --- protobuf, as far as dag-pb and UnixFS use it ---

   struct Field
   {
      std::uint64_t number;
      std::uint64_t varint = 0;  // wire type 0
      ByteView      bytes;       // wire type 2
      unsigned      wireType;
   };

   inline std::optional<Field> readField(ByteView& in)
   {
      auto tag = readVarint(in);
      if (!tag)
         return std::nullopt;
      Field f{.number = *tag >> 3, .wireType = static_cast<unsigned>(*tag & 7)};
      if (f.wireType == 0)
      {
         auto v = readVarint(in);
         if (!v)
            return std::nullopt;
         f.varint = *v;
      }
      else if (f.wireType == 2)
      {
         auto n = readVarint(in);
         if (!n || *n > in.size())
            return std::nullopt;
         f.bytes = in.first(*n);
         in      = in.subspan(*n);
      }
      else
      {
         // dag-pb and UnixFS use no other wire types.
         return std::nullopt;
      }
      return f;
   }

   struct Link
   {
      Cid           cid;
      std::string   name;
      std::uint64_t size = 0;
   };

   struct Node
   {
      std::vector<Link> links;
      ByteView          data;  // the UnixFS record, if any
   };

   inline std::optional<Node> parseDagPb(ByteView in)
   {
      Node node;
      while (!in.empty())
      {
         auto f = readField(in);
         if (!f)
            return std::nullopt;
         if (f->number == 1 && f->wireType == 2)
            node.data = f->bytes;
         else if (f->number == 2 && f->wireType == 2)
         {
            Link link;
            bool hasCid = false;
            auto inner  = f->bytes;
            while (!inner.empty())
            {
               auto g = readField(inner);
               if (!g)
                  return std::nullopt;
               if (g->number == 1 && g->wireType == 2)
               {
                  auto cid = parseCidBytes(g->bytes);
                  if (!cid)
                     return std::nullopt;
                  link.cid = *cid;
                  hasCid   = true;
               }
               else if (g->number == 2 && g->wireType == 2)
                  link.name.assign(g->bytes.begin(), g->bytes.end());
               else if (g->number == 3 && g->wireType == 0)
                  link.size = g->varint;
               else
                  return std::nullopt;
            }
            if (!hasCid)
               return std::nullopt;
            node.links.push_back(std::move(link));
         }
         else
            return std::nullopt;
      }
      return node;
   }

   enum class UnixFsType : std::uint64_t
   {
      raw       = 0,
      directory = 1,
      file      = 2,
      metadata  = 3,
      symlink   = 4,
      hamtShard = 5,
   };

   struct UnixFs
   {
      UnixFsType                   type = UnixFsType::raw;
      ByteView                     data;
      std::optional<std::uint64_t> fileSize;
   };

   inline std::optional<UnixFs> parseUnixFs(ByteView in)
   {
      UnixFs result;
      bool   hasType = false;
      while (!in.empty())
      {
         auto f = readField(in);
         if (!f)
            return std::nullopt;
         if (f->number == 1 && f->wireType == 0)
         {
            if (f->varint > 5)
               return std::nullopt;
            result.type = static_cast<UnixFsType>(f->varint);
            hasType     = true;
         }
         else if (f->number == 2 && f->wireType == 2)
            result.data = f->bytes;
         else if (f->number == 3 && f->wireType == 0)
            result.fileSize = f->varint;
         // blocksizes (4), hashType (5), fanout (6), mode (7), mtime (8): not needed
      }
      if (!hasType)
         return std::nullopt;
      return result;
   }
}  // namespace LocalService::ipfs
