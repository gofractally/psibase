#include <psibase/Socket.hpp>

#include <psibase/api.hpp>
#include <psibase/nativeTables.hpp>

using namespace psibase;

static constexpr auto wasi_errno_acces  = 2;
static constexpr auto wasi_errno_badf   = 8;
static constexpr auto wasi_errno_notsup = 58;

namespace psibase
{
   std::uint32_t operator&(std::uint32_t lhs, SocketFlags rhs)
   {
      return lhs & static_cast<std::uint32_t>(rhs);
   }
}  // namespace psibase

namespace
{
   bool closeRequested(const AutoCloseSocket& socket)
   {
      return socket.forceClose || socket.autoClosing;
   }

   // Once this is true, no reads will happen, writes are forbidden,
   // and changing flags is forbidden.
   bool isClosing(const AutoCloseSocket& socket)
   {
      return closeRequested(socket) && socket.closeLocks == 0;
   }

   bool tryConsumeRecv(AutoCloseSocket& socket)
   {
      if (socket.receiving && socket.pendingRecv && !closeRequested(socket))
      {
         socket.receiving   = false;
         socket.pendingRecv = false;
         ++socket.closeLocks;
         return true;
      }
      else
      {
         return false;
      }
   }

   bool tryClose(AutoCloseSocket& socket, Sockets& parent)
   {
      if (isClosing(socket) && !socket.closed)
      {
         socket.closed = true;
         return true;
      }
      else
      {
         return false;
      }
   }
}  // namespace

Socket::~Socket()
{
   if (auto sockets = weak_sockets.lock())
   {
      std::lock_guard l{sockets->mutex};
      sockets->available.set(id);
   }
}

bool Socket::canAutoClose() const
{
   return false;
}

void AutoCloseSocket::replace(Writer& writer, std::shared_ptr<AutoCloseSocket>&& other)
{
   if (auto sockets = weak_sockets.lock())
   {
      SocketRow row{id, other->info()};
      other->id = id;
      {
         std::lock_guard l{sockets->mutex};
         other->weak_sockets  = std::move(weak_sockets);
         other->notifyClose   = notifyClose;
         other->autoClosing   = autoClosing;
         other->receiving     = receiving;
         other->closeLocks    = closeLocks;
         sockets->sockets[id] = std::move(other);
      }
      sockets->sharedDb.kvPutSubjective(writer, SocketRow::db, psio::convert_to_key(row.key()),
                                        psio::to_frac(row));
   }
}

void Socket::remove(Writer& writer)
{
   if (auto sockets = weak_sockets.lock())
   {
      auto key = socketKey(id);
      sockets->sharedDb.kvRemoveSubjective(writer, SocketRow::db, psio::convert_to_key(key));
      {
         std::lock_guard l{sockets->mutex};
         sockets->available.set(id);
         weak_sockets.reset();
         if (!sockets->stopped)
            sockets->sockets[static_cast<std::size_t>(id)].reset();
      }
   }
}

void Socket::writeInfo(Writer& writer)
{
   if (auto sockets = weak_sockets.lock())
   {
      SocketRow row{id, info()};
      sockets->sharedDb.kvPutSubjective(writer, SocketRow::db, psio::convert_to_key(row.key()),
                                        psio::to_frac(row));
   }
}

bool AutoCloseSocket::canAutoClose() const
{
   return true;
}

void AutoCloseSocket::onLock(CloseLock&&)
{
   assert(!"onLock must be implemented if a socket calls Sockets::lockRecv");
}

void SocketAutoCloseSet::close(Writer&                           writer,
                               Sockets&                          parent,
                               const std::optional<std::string>& message)
{
   std::vector<std::shared_ptr<AutoCloseSocket>> toClose;
   {
      std::lock_guard l{parent.mutex};
      if (parent.stopped)
         return;
      for (std::int32_t id : sockets)
      {
         auto& base = parent.sockets[static_cast<std::size_t>(id)];
         assert(base->canAutoClose());
         auto socket = std::static_pointer_cast<AutoCloseSocket>(base);
         assert(socket->closeLocks != 0);
         --socket->closeLocks;
         if (tryClose(*socket, parent))
         {
            toClose.push_back(std::move(socket));
         }
      }
   }
   for (const auto& socket : toClose)
   {
      socket->onClose(message);
   }
   sockets.clear();
}
SocketAutoCloseSet::~SocketAutoCloseSet()
{
   assert(sockets.empty() && "SocketAutoCloseSet must be explicitly closed before being destroyed");
}

bool SocketAutoCloseSet::owns(Sockets& parent, const std::shared_ptr<AutoCloseSocket>& sock)
{
   if (sockets.find(sock->id) == sockets.end())
      return false;
   std::lock_guard l{parent.mutex};
   return sock->autoClosing && parent.sockets[static_cast<std::size_t>(sock->id)] == sock;
}

namespace
{
   void updateSocketFlags(const std::shared_ptr<AutoCloseSocket>& sockptr,
                          std::uint32_t                           mask,
                          std::uint32_t                           value,
                          SocketAutoCloseSet*                     owner)
   {
      if (mask & SocketFlags::lockClose)
      {
         if (value & SocketFlags::lockClose)
         {
            if (owner->sockets.insert(sockptr->id).second)
               ++sockptr->closeLocks;
         }
         else
         {
            assert(sockptr->closeLocks != 0);
            if (owner->sockets.erase(sockptr->id))
               --sockptr->closeLocks;
         }
      }
      if (mask & SocketFlags::notifyClose)
      {
         sockptr->notifyClose = (value & SocketFlags::notifyClose) != 0;
      }
      if (mask & SocketFlags::autoClose)
      {
         sockptr->autoClosing = (value & SocketFlags::autoClose) != 0;
      }
      if (mask & SocketFlags::recv)
      {
         sockptr->receiving = (value & SocketFlags::recv) != 0;
      }
   }

   std::int32_t checkSocketFlags(const std::shared_ptr<AutoCloseSocket>& sockptr,
                                 std::uint32_t                           mask,
                                 std::uint32_t                           value,
                                 SocketAutoCloseSet*                     owner)
   {
      // Once autoClose triggers, it can't be disabled
      if (isClosing(*sockptr))
         return wasi_errno_acces;
      return 0;
   }
}  // namespace

Sockets::Sockets(SharedDatabase sharedDb) : sharedDb(std::move(sharedDb))
{
   // emptyRevision is okay, because we only need the subjective db
   Database db{this->sharedDb, sharedDb.emptyRevision()};
   auto     session = db.startRead();
   db.checkoutSubjective();
   auto                   key       = psio::convert_to_key(socketPrefix());
   auto                   prefixLen = key.size();
   std::vector<SocketRow> rows;
   if (db.kvGreaterEqualRaw(SocketRow::db, key, prefixLen))
   {
      abortMessage("Socket table should start empty");
   }
}

void Sockets::shutdown()
{
   std::unique_lock l{mutex};
   stopped         = true;
   auto tmpsockets = std::move(sockets);
   l.unlock();
   tmpsockets.clear();
}

std::int32_t Sockets::send(Writer& writer, std::int32_t fd, std::span<const char> buf)
{
   std::shared_ptr<Socket> p;
   {
      std::lock_guard l{mutex};
      if (fd >= 0 && fd < sockets.size())
         p = sockets[fd];
      if (!p)
         return wasi_errno_badf;
   }

   p->send(writer, buf);
   return 0;
}
void Sockets::add(Writer&                        writer,
                  const std::shared_ptr<Socket>& socket,
                  SocketAutoCloseSet*            owner,
                  Database*                      db)
{
   {
      std::lock_guard l{mutex};
      check(!stopped, "Shutting down");
      if (auto pos = available.find_first(); pos != boost::dynamic_bitset<>::npos)
      {
         socket->id   = pos;
         sockets[pos] = socket;
         available.reset(pos);
      }
      else
      {
         check(
             sockets.size() <= static_cast<std::uint32_t>(std::numeric_limits<std::int32_t>::max()),
             "Too many open sockets");

         // TODO: exception safety
         socket->id = sockets.size();
         sockets.push_back(socket);
         available.push_back(false);
      }
      if (owner)
      {
         assert(socket->canAutoClose());
         auto sockptr = std::static_pointer_cast<AutoCloseSocket>(socket);
         assert(sockptr->closeLocks == 0);
         sockptr->autoClosing = true;
         sockptr->closeLocks  = 1;
         owner->sockets.insert(sockptr->id);
      }
      socket->weak_sockets = shared_from_this();
   }

   {
      SocketRow row{socket->id, socket->info()};
      if (db)
      {
         db->kvPut(SocketRow::db, row.key(), row);
      }
      else
      {
         sharedDb.kvPutSubjective(writer, SocketRow::db, psio::convert_to_key(row.key()),
                                  psio::to_frac(row));
      }
   }
}
void Sockets::set(Writer& writer, std::int32_t fd, const std::shared_ptr<Socket>& socket)
{
   bool existing = false;
   {
      std::lock_guard l{mutex};
      check(!stopped, "Shutting down");
      check(fd >= 0, "invalid fd");
      auto pos = static_cast<std::size_t>(fd);
      if (pos + 1 > available.size())
      {
         available.resize(pos + 1, true);
         sockets.resize(pos + 1);
      }
      if (!available[pos])
      {
         check(sockets[pos]->info() == socket->info(), "Replacing socket does not match");
         sockets[pos]->weak_sockets.reset();
         sockets[pos] = socket;
         socket->id   = fd;
         existing     = true;
      }
      else
      {
         socket->id   = fd;
         sockets[pos] = socket;
         available.reset(pos);
      }

      socket->weak_sockets = shared_from_this();
   }
   if (!existing)
   {
      SocketRow row{socket->id, socket->info()};
      sharedDb.kvPutSubjective(writer, SocketRow::db, psio::convert_to_key(row.key()),
                               psio::to_frac(row));
   }
}
void Sockets::remove(Writer& writer, const std::shared_ptr<Socket>& socket, Database* db)
{
   bool matched = false;
   {
      std::lock_guard l{mutex};
      if (socket->id >= 0 && socket->id < sockets.size() && sockets[socket->id] == socket)
      {
         socket->closed = true;
         sockets[socket->id].reset();
         matched = true;
      }
   }
   if (matched)
   {
      auto key = socketKey(socket->id);
      if (db)
      {
         db->kvRemove(SocketRow::db, key);
      }
      else
      {
         sharedDb.kvRemoveSubjective(writer, SocketRow::db, psio::convert_to_key(key));
      }
   }
}

std::int32_t Sockets::setFlags(std::int32_t               fd,
                               std::uint32_t              mask,
                               std::uint32_t              value,
                               SocketAutoCloseSet*        owner,
                               std::vector<SocketChange>* diff)
{
   std::unique_lock l{mutex};

   if (fd < 0 || fd >= sockets.size() || !sockets[fd])
      return wasi_errno_badf;
   auto p = sockets[fd];

   if (!p->canAutoClose())
      return wasi_errno_notsup;

   auto sockptr = std::static_pointer_cast<AutoCloseSocket>(p);

   if (auto err = checkSocketFlags(sockptr, mask, value, owner))
      return err;

   if (diff)
   {
      diff->push_back({sockptr, static_cast<std::uint8_t>(mask), static_cast<std::uint8_t>(value)});
   }
   else
   {
      updateSocketFlags(sockptr, mask, value, owner);
      bool acquireLock = tryConsumeRecv(*sockptr);
      bool close       = tryClose(*sockptr, *this);
      l.unlock();
      if (acquireLock)
         sockptr->onLock(CloseLock{this, sockptr.get()});
      if (close)
         sockptr->onClose(std::nullopt);
   }
   return 0;
}

void Sockets::asyncClose(AutoCloseSocket& socket)
{
   bool close;
   {
      std::lock_guard l{mutex};
      socket.forceClose = true;
      close             = tryClose(socket, *this);
   }
   if (close)
      socket.onClose(std::nullopt);
}

CloseLock Sockets::lockRecv(const std::shared_ptr<AutoCloseSocket>& socket)
{
   bool            okay = false;
   std::lock_guard l{mutex};
   assert(!socket->pendingRecv);
   if (socket->receiving)
   {
      socket->receiving = false;
      ++socket->closeLocks;
      return CloseLock{this, socket.get()};
   }
   else
   {
      socket->pendingRecv = true;
      return CloseLock{nullptr, nullptr};
   }
}

CloseLock Sockets::lockClose(const std::shared_ptr<AutoCloseSocket>& socket)
{
   assert(socket->weak_sockets.lock().get() == this);
   std::lock_guard l{mutex};
   if (!socket->closed)
   {
      ++socket->closeLocks;
      return CloseLock{this, socket.get()};
   }
   else
   {
      return CloseLock{nullptr, nullptr};
   }
}

CloseLock::CloseLock(CloseLock&& other) : self(other.self), socket(other.socket)
{
   other.self   = nullptr;
   other.socket = -1;
}

CloseLock::CloseLock(const CloseLock& other) : self(other.self), socket(other.socket)
{
   assert(!"CloseLock should not be copied, but type erasure requires a copy constructor even when it isn't actually used.");
   if (self)
   {
      std::lock_guard l{self->mutex};
      auto&           base{self->sockets[static_cast<std::size_t>(this->socket)]};
      assert(base->canAutoClose());
      auto* socket = static_cast<AutoCloseSocket*>(base.get());
      assert(socket->closeLocks != 0);
      ++socket->closeLocks;
   }
}

CloseLock::~CloseLock()
{
   if (self)
   {
      std::unique_lock l{self->mutex};
      if (self->stopped)
         return;
      auto& base{self->sockets[static_cast<std::size_t>(this->socket)]};
      assert(base->canAutoClose());
      auto* socket = static_cast<AutoCloseSocket*>(base.get());
      assert(socket->closeLocks != 0);
      --socket->closeLocks;
      l.unlock();
      if (tryClose(*socket, *self))
         socket->onClose(std::nullopt);
   }
}

CloseLock::operator bool() const
{
   return self != nullptr;
}

CloseLock::CloseLock(Sockets* self, AutoCloseSocket* socket)
    : self(self), socket(socket ? socket->id : -1)
{
}

void Sockets::setOwner(CloseLock&& rl, SocketAutoCloseSet* owner)
{
   assert(rl.self);
   auto [_, inserted] = owner->sockets.insert(rl.socket);
   assert(inserted);
   rl.self   = nullptr;
   rl.socket = -1;
}

bool Sockets::applyChanges(std::vector<SocketChange>&& diff, SocketAutoCloseSet* owner)
{
   {
      std::lock_guard l{mutex};
      for (const auto& change : diff)
      {
         if (checkSocketFlags(change.socket, change.mask, change.value, owner) != 0)
            return false;
      }
      for (const auto& change : diff)
      {
         updateSocketFlags(change.socket, change.mask, change.value, owner);
      }
      // Processing pending locks has to come after updating all sockets,
      // because autoClose might be disabled and then re-enabled again
      // in the changeset.
      for (auto& change : diff)
      {
         change.value = 0;
         if (tryConsumeRecv(*change.socket))
         {
            change.value |= static_cast<std::uint32_t>(SocketFlags::recv);
         }
         if (tryClose(*change.socket, *this))
         {
            change.value |= static_cast<std::uint32_t>(SocketFlags::lockClose);
         }
      }
   }
   for (const auto& change : diff)
   {
      if (change.value & SocketFlags::recv)
         change.socket->onLock(CloseLock{this, change.socket.get()});
      if (change.value & SocketFlags::lockClose)
         change.socket->onClose(std::nullopt);
   }
   return true;
}
