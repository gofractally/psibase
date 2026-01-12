#pragma once

#include <boost/dynamic_bitset.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/SocketInfo.hpp>
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
      virtual void       send(Writer&, std::span<const char>) = 0;
      virtual bool       canAutoClose() const;
      virtual bool       supportsP2P() const;
      virtual SocketInfo info() const = 0;

      void replace(Writer& writer, std::shared_ptr<Socket>&& other);
      void writeInfo(Writer& writer);

      std::int32_t           id;
      bool                   closed = false;
      bool                   once   = false;
      std::weak_ptr<Sockets> weak_sockets;
   };

   struct SocketAutoCloseSet;

   struct AutoCloseSocket : Socket
   {
      virtual bool canAutoClose() const override;
      virtual void autoClose(const std::optional<std::string>& message) noexcept = 0;
      virtual void enableP2P(std::function<void(const std::shared_ptr<net::connection_base>&)>);
      virtual void onLock();
      // owner can be non-null if either autoClosing or autoCloseLocked is true
      // If autoCloseLocked is true, then only the context that holds the lock
      // can set autoClose.
      SocketAutoCloseSet* owner           = nullptr;
      bool                autoCloseLocked = false;
      bool                autoClosing     = false;
      bool                pendingLock     = false;
   };

   struct SocketChange
   {
      std::shared_ptr<AutoCloseSocket> socket;
      SocketAutoCloseSet*              owner;
      std::uint32_t                    flags;

      static const std::uint32_t setP2PFlag = 1;
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
                       SocketAutoCloseSet*            owner = nullptr,
                       Database*                      db    = nullptr);
      void         set(Writer& writer, std::int32_t fd, const std::shared_ptr<Socket>& socket);
      void remove(Writer& writer, const std::shared_ptr<Socket>& socket, Database* db = nullptr);
      std::int32_t autoClose(std::int32_t               socket,
                             bool                       value,
                             SocketAutoCloseSet*        owner,
                             std::vector<SocketChange>* diff = nullptr);
      std::int32_t enableP2P(std::int32_t               socket,
                             SocketAutoCloseSet*        owner,
                             std::vector<SocketChange>* diff,
                             std::function<void(const std::shared_ptr<net::connection_base>&)>);
      /// Returns true if autoClose was locked immediately for the socket.
      /// If the socket currently has autoClose enabled, the lock will be
      /// acquired when autoClose is disabled, and AutoCloseSocket::onLock
      /// will be called.
      bool lockAutoClose(const std::shared_ptr<AutoCloseSocket>& socket);
      void unlockAutoClose(const std::shared_ptr<AutoCloseSocket>& socket);
      void setOwner(const std::shared_ptr<AutoCloseSocket>& socket, SocketAutoCloseSet* owner);
      bool applyChanges(const std::vector<SocketChange>& diff,
                        SocketAutoCloseSet*              owner,
                        const DatabaseCallbacks*         callbacks);
   };

}  // namespace psibase
