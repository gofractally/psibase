#pragma once

#include <boost/dynamic_bitset.hpp>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <psibase/SocketInfo.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <span>
#include <vector>

namespace psibase
{
   struct Sockets;
   struct AutoCloseSocket;

   struct CloseLock
   {
     public:
      CloseLock(CloseLock&&);
      CloseLock(const CloseLock&);
      ~CloseLock();
      explicit operator bool() const;

     private:
      friend class Sockets;
      CloseLock(Sockets* self, AutoCloseSocket* socket);
      Sockets*     self;
      std::int32_t socket;
   };

   struct Socket
   {
      ~Socket();
      virtual void       send(Writer&, std::span<const char>) = 0;
      virtual bool       canAutoClose() const;
      virtual SocketInfo info() const = 0;

      void remove(Writer& writer);
      void writeInfo(Writer& writer);

      std::int32_t           id;
      bool                   closed = false;
      std::weak_ptr<Sockets> weak_sockets;
   };

   struct SocketAutoCloseSet;

   struct AutoCloseSocket : Socket
   {
      virtual bool canAutoClose() const override;
      /// \pre closed is true
      /// \pre closeLocks == 0
      /// \pre either forceClose or autoClosing is true
      ///
      /// Once this starts, any attempt to acquire a close lock or change
      /// notifyClose or autoClose will fail
      ///
      /// This MUST NOT run wasm directly. It should post its work to
      /// the execution context associated with the socket:
      /// - If notifyClose is set, call x-http::recv(id),
      /// - call this->remove
      /// - If required by the socket, send an error
      /// - Shutdown and close the socket
      /// - Clean up all remaining shared_ptrs
      virtual void onClose(const std::optional<std::string>& message) noexcept = 0;
      /// Called when the recv lock is acquired asynchronously. This
      /// should post to an appropriate executor. It MUST NOT run
      /// wasm directly.
      virtual void onLock(CloseLock&&);
      /// Replaces this socket with another socket, preserving socket flags.
      /// - Pending asyncClose and lockRecv are not preserved, because
      ///   they depend on the underlying socket.
      void          replace(Writer& writer, std::shared_ptr<AutoCloseSocket>&& other);
      bool          forceClose  = false;
      bool          notifyClose = false;
      bool          autoClosing = false;
      bool          receiving   = false;
      std::uint16_t closeLocks  = 0;
      bool          pendingRecv = false;
   };

   struct SocketChange
   {
      std::shared_ptr<AutoCloseSocket> socket;
      std::uint32_t                    mask;
      std::uint32_t                    value;
   };

   struct SocketAutoCloseSet
   {
      std::set<std::int32_t> sockets;
      void close(Writer& writer, Sockets& sockets, const std::optional<std::string>& message = {});
      bool owns(Sockets& sockets, const std::shared_ptr<AutoCloseSocket>& sock);
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
      void         remove(Writer& writer, const std::shared_ptr<Socket>& socket, Database* db);
      std::int32_t setFlags(std::int32_t               socket,
                            std::uint32_t              mask,
                            std::uint32_t              value,
                            SocketAutoCloseSet*        owner,
                            std::vector<SocketChange>* diff);

      /// Marks a socket for closing. This is irreversible and cannot
      /// be affected directly by WASM. This should be called when
      /// the socket is closed at the remote end, when there is an
      /// error, or when other conditions on the host cause the
      /// connection to be closed.
      void asyncClose(AutoCloseSocket& socket);

      /// Prevents the socket from being closed
      CloseLock lockClose(const std::shared_ptr<AutoCloseSocket>& socket);
      /// This will either return an acquired lock or cause onLock to be
      /// called as soon as the lock can be acquired. If the socket is
      /// closed, onLock might never be called.
      CloseLock lockRecv(const std::shared_ptr<AutoCloseSocket>& socket);
      void      setOwner(CloseLock&& l, SocketAutoCloseSet* owner);
      bool      applyChanges(std::vector<SocketChange>&& diff, SocketAutoCloseSet* owner);
   };

}  // namespace psibase
