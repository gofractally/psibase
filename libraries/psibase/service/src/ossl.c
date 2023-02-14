// openssl 3.0.7 (and probably earlier) uses these
int getpid() { return 0; }
int getuid() { return 0; }
int geteuid() { return 0; }
int getgid() { return 0; }
int getegid() { return 0; }
