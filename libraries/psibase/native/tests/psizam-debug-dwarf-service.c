// A service with DWARF for the service-debugging tests (ServiceDebugTests.cpp):
// the C counterpart of psizam-debug-service.wat, with the modes the tests need
// a source position for. psizam-debug-dwarf-service.wasm is this file compiled
// with wasi-sdk 32.0 (clang 22.1.0):
//
//   cd libraries/psibase/native/tests && $WASI_SDK/bin/clang --target=wasm32-wasip1 -g -O0 \
//     -fdebug-compilation-dir=. -nostdlib -Wl,--no-entry -Wl,-z,stack-size=8388608 \
//     -Wl,--export=start -Wl,--export=processTransaction -Wl,--export=called \
//     -o psizam-debug-dwarf-service.wasm psizam-debug-dwarf-service.c
//
// Run it from this directory with the relative file name, so the DWARF names
// the source as "psizam-debug-dwarf-service.c" and holds no absolute path. The
// tests require the lines marked below (the constants at the top of
// ServiceDebugTests.cpp); keep the two in step and rebuild the .wasm whenever
// this file changes. The linear stack is large so that runaway recursion ends
// at the chain's stack budget and not at the end of the module's own stack.
//
// As in the .wat service, the byte after "####" in the current action is the
// mode and the next byte an argument.

typedef unsigned int       u32;
typedef unsigned long long u64;

#define IMPORT(name) __attribute__((import_module("env"), import_name(#name)))
IMPORT(getCurrentAction) u32 getCurrentAction(void);
IMPORT(getResult) u32 getResult(char* dest, u32 size, u32 offset);
IMPORT(call) u32 call(const char* action, u32 size, u64 flags);
IMPORT(abortMessage) void abortMessage(const char* message, u32 size);
IMPORT(writeConsole) void writeConsole(const char* text, u32 size);
IMPORT(setRetval) void setRetval(const char* data, u32 size);
IMPORT(kvOpen) u32 kvOpen(u32 db, const char* prefix, u32 size, u32 mode);
IMPORT(kvPut) void kvPut(u32 handle, const char* key, u32 keySize, const char* value, u32 size);

// A length and an Action for the peer service, written in by the test.
char peer_abort_action[64] = "DEBUG_PEER_ABORT_ACTION";
char peer_write_action[64] = "DEBUG_PEER_WRITE_ACTION";

static char action[4096];
static int  mode;
static char argument;

static void read_action(void)
{
   // The node calls back into a running service, so a mode must not outlive
   // its action.
   mode     = 0;
   u32 size = getCurrentAction();
   if (size > sizeof(action))
      return;
   getResult(action, size, 0);
   for (u32 at = 0; at + 6 <= size; ++at)
      if (action[at] == '#' && action[at + 1] == '#' && action[at + 2] == '#' &&
          action[at + 3] == '#')
      {
         mode     = action[at + 4];
         argument = action[at + 5];
         return;
      }
}

static void debug_write(void)
{
   char key[8]   = {'d', 'e', 'b', 'u', 'g', '-', 'k', argument};
   char value[4] = {argument, 0, 0, 0};
   u32  handle   = kvOpen(0, key, 0, 3);  // DbId::service, no prefix, KvMode::readWrite
   kvPut(handle, key, sizeof(key), value, sizeof(value));
   writeConsole("debug fixture ran", 17);
   setRetval(value, sizeof(value));
}

u64 debug_recurse(u64 depth)
{
   return debug_recurse(depth + 1) + 1;  // line 73
}

void debug_inner(int failure)
{
   volatile int zero = 0;
   if (failure == 1)
      debug_write();
   else if (failure == 2)
      __builtin_trap();
   else if (failure == 3)
      abortMessage("debug fixture abort", 19);  // line 84
   else if (failure == 4)
      debug_recurse(0);
   else if (failure == 5)
      for (;;)
         ;
   else if (failure == 6)
      zero = 1 / zero;  // line 91
   else if (failure == 13)
      call(peer_abort_action + 4, *(u32*)peer_abort_action, 0);  // line 93
   else if (failure == 14)
   {
      call(peer_write_action + 4, *(u32*)peer_write_action, 0);
      debug_write();
   }
}

void debug_middle(int failure)
{
   int doubled = failure * 2;
   debug_inner(doubled / 2);  // line 104
}

void debug_outer(void)
{
   read_action();
   debug_middle(mode);  // line 110
}

void start(u64 service) {}

void processTransaction(void)
{
   debug_outer();  // line 117
}

void called(u64 service, u64 sender)
{
   debug_outer();
}
