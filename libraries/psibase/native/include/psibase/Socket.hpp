#pragma once

#include <boost/dynamic_bitset.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <set>
#include <span>
#include <vector>

namespace psibase
{
   struct Sockets;
   struct Socket
   {
      ~Socket();
      virtual void           send(std::span<const char>) = 0;
      virtual bool           canAutoClose() const;
      virtual SocketInfo     info() const = 0;
      std::int32_t           id;
      bool                   closed = false;
      bool                   once   = false;
      std::weak_ptr<Sockets> weak_sockets;
   };

   struct SocketAutoCloseSet;

   struct AutoCloseSocket : Socket
   {
      virtual bool        canAutoClose() const override;
      virtual void        autoClose(const std::optional<std::string>& message) noexcept = 0;
      SocketAutoCloseSet* owner                                                         = nullptr;
   };

   struct SocketChange
   {
      std::shared_ptr<AutoCloseSocket> socket;
      SocketAutoCloseSet*              owner;
   };

   struct SocketAutoCloseSet
   {
      std::set<std::shared_ptr<AutoCloseSocket>> sockets;
      void close(Writer& writer, Sockets& sockets, const std::optional<std::string>& message = {});
      bool owns(Sockets& sockets, const AutoCloseSocket& sock);
      ~SocketAutoCloseSet();
   };

   struct Sockets : std::enable_shared_from_this<Sockets>
   {
      SharedDatabase                       sharedDb;
      std::vector<std::shared_ptr<Socket>> sockets;
      boost::dynamic_bitset<>              available;
      bool                                 stopped = false;
      std::mutex                           mutex;
      explicit Sockets(SharedDatabase sharedDb);
      void         shutdown();
      std::int32_t send(Writer& writer, std::int32_t fd, std::span<const char> buf);
      void         add(Writer&                        writer,
                       const std::shared_ptr<Socket>& socket,
                       SocketAutoCloseSet*            owner = nullptr);
      void         set(Writer& writer, std::int32_t fd, const std::shared_ptr<Socket>& socket);
      void         remove(Writer& writer, const std::shared_ptr<Socket>& socket);
      std::int32_t autoClose(std::int32_t               socket,
                             bool                       value,
                             SocketAutoCloseSet*        owner,
                             std::vector<SocketChange>* diff = nullptr);
      bool         applyChanges(const std::vector<SocketChange>& diff, SocketAutoCloseSet* owner);
   };

}  // namespace psibase
