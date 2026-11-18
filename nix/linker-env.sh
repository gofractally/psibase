# Scrub host /usr lib dirs from the Nix linker env.
#
# Cursor's buildFHSEnv sandbox (etc/profile) prepends "-L/usr/lib -L/usr/lib32"
# to NIX_LDFLAGS and NIX_CFLAGS_LINK in every integrated terminal. Left alone,
# -lrt/-ldl resolve to the host glibc and the ld-wrapper bakes /usr/lib into
# RUNPATH, so psinode/psitest mix host librt with Nix libc (GLIBC_PRIVATE).
#
# That is the only thing this file does. Library *resolution* is otherwise left
# to Nix: no LD_LIBRARY_PATH, and the cc/ld wrapper's RUNPATH logic stays on
# (see the shellHook comment in flake.nix).
#
# Sourced by the flake shellHook and by .editor-shared/scripts/build.sh.

__psibase_filter_usr_Lflags() {
  local out="" f
  for f in $1; do
    case "$f" in
      -L/usr/lib|-L/usr/lib/*|-L/usr/lib32|-L/usr/lib32/*|-L/usr/lib64|-L/usr/lib64/*) continue ;;
    esac
    out="${out:+$out }$f"
  done
  printf '%s' "$out"
}

__psibase_filter_usr_path() {
  local out="" p IFS=':'
  for p in $1; do
    case "$p" in
      /usr/lib|/usr/lib/*|/usr/lib32|/usr/lib32/*|/usr/lib64|/usr/lib64/*) continue ;;
    esac
    [ -n "$p" ] || continue
    out="${out:+$out:}$p"
  done
  printf '%s' "$out"
}

NIX_CFLAGS_LINK="$(__psibase_filter_usr_Lflags "${NIX_CFLAGS_LINK:-}")"
NIX_LDFLAGS="$(__psibase_filter_usr_Lflags "${NIX_LDFLAGS:-}")"
NIX_LDFLAGS_BEFORE="$(__psibase_filter_usr_Lflags "${NIX_LDFLAGS_BEFORE:-}")"
export NIX_CFLAGS_LINK NIX_LDFLAGS NIX_LDFLAGS_BEFORE

LIBRARY_PATH="$(__psibase_filter_usr_path "${LIBRARY_PATH:-}")"
export LIBRARY_PATH

unset -f __psibase_filter_usr_Lflags __psibase_filter_usr_path
