#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <vector>

namespace LocalService
{
   // One IPFS block: its bytes, by the sha2-256 of those bytes. Whether a
   // block is a file's raw bytes or a dag-pb node is said by the content id
   // that asks for it, not stored here.
   struct IpfsBlockRow
   {
      psibase::Checksum256 digest = {};
      std::vector<char>    data   = {};
      PSIO_REFLECT(IpfsBlockRow, digest, data)
   };
   using IpfsBlockTable = psibase::Table<IpfsBlockRow, &IpfsBlockRow::digest>;
   PSIO_REFLECT_TYPENAME(IpfsBlockTable)

   /// The node's file store for public data (gofractally/psibase#2312).
   ///
   /// Files are kept as IPFS blocks and addressed by content id. This is the
   /// IPFS format only: blocks are uploaded to and served by this node over
   /// HTTP; the node does not join the IPFS network.
   ///
   /// - `PUT /block/<cid>`: store one block. The body must hash to the id.
   ///   Needs a signed-in account, or the node's administrator.
   /// - `GET|HEAD /block/<cid>`: one block as it was stored. Open to anyone.
   /// - `GET|HEAD /ipfs/<cid>[/path]`: a file, or a file inside a directory,
   ///   put together from its blocks. Open to anyone, and never changes, so
   ///   it may be cached for ever.
   ///
   /// Everything stored here is public.
   struct XIpfs : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-ipfs"};

      using Subjective = psibase::SubjectiveTables<IpfsBlockTable>;

      // A block larger than this is refused. IPFS tools make blocks of at
      // most 1 MiB of file data; a directory node can be somewhat larger.
      static constexpr std::size_t maxBlockSize = 2 * 1024 * 1024;
      // A file is put together in memory to be sent, so one request serves
      // at most this much. Larger files are for tools on the node, which
      // read them block by block.
      static constexpr std::size_t maxServedFile = 16 * 1024 * 1024;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XIpfs, method(serveSys, req, socket))
   PSIBASE_REFLECT_TABLES(XIpfs, XIpfs::Subjective)
}  // namespace LocalService
