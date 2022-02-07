[[noreturn]] extern "C" void abort();

// Replace libc++abi abort_message, which pulls in *printf
[[noreturn]] extern "C" void abort_message(const char*, ...)
{
   abort();
}
