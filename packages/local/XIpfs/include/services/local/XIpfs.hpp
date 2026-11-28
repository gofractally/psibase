#pragma once

#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>

namespace LocalService
{
   /// The node's file store for public data (gofractally/psibase#2312).
   ///
   /// Files are addressed by IPFS content id. This is the IPFS format only:
   /// files are uploaded to and served by this node over HTTP; the node does
   /// not join the IPFS network.
   ///
   /// A file of any size is one plain file in the node's file store, outside
   /// the database, and is sent from there by the node itself: this service
   /// decides what is sent and to whom, and never carries the bytes of a
   /// download.
   ///
   /// A file larger than one part is uploaded as its IPFS root node (which
   /// lists the hashes of its parts) and then the parts in order, each
   /// checked against its hash. Parts are `partSize` bytes, all but the last.
   ///
   /// - `PUT /block/<cid>`: a whole file of at most one part (a raw block),
   ///   or a node (a directory, or the root node of a larger file).
   /// - `GET /file/<cid>`: how far the upload of a larger file has got: the
   ///   index of the next part wanted, or `complete`.
   /// - `PUT /file/<cid>/<index>`: the next part of a larger file.
   /// - `GET|HEAD /block/<cid>`: a stored block as it was uploaded.
   /// - `GET|HEAD /ipfs/<cid>[/path]`: a file, or a file inside a directory
   ///   (a directory stands for its index.html). `Range` is honoured.
   ///
   /// Uploading needs a signed-in account or the node's administrator.
   /// Reading is open to anyone, and what a content id names never changes,
   /// so replies may be cached for ever. Everything stored here is public.
   struct XIpfs : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-ipfs"};

      // The size of a part of a file. A content id depends on it: this is
      // what `ipfs add --cid-version=1 --raw-leaves --chunker=size-1048576`
      // produces.
      static constexpr std::uint64_t partSize = 1024 * 1024;
      // A node (a directory listing, or the list of a file's parts) is at
      // most this large; it is read into this service to be interpreted.
      static constexpr std::size_t maxNodeSize = 2 * 1024 * 1024;

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        req,
                                                 std::optional<std::int32_t> socket);
   };
   PSIO_REFLECT(XIpfs, method(serveSys, req, socket))
}  // namespace LocalService
