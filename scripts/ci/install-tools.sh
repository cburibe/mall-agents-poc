#!/usr/bin/env bash
# Instala herramientas binarias fijadas por versión y sha256 en .tools/bin (local y CodeBuild).
# BP-PIPE-09 (versiones fijadas), LLM03 (cadena de suministro).
set -euo pipefail

UV_VERSION="0.13.6"
GITLEAKS_VERSION="8.30.1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${ROOT}/.tools/bin"
mkdir -p "${BIN}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

os="$(uname -s)"
arch="$(uname -m)"
case "${os}/${arch}" in
  Linux/aarch64)
    uv_target="aarch64-unknown-linux-gnu"
    uv_sha="229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d"
    gl_target="linux_arm64"
    gl_sha="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
    ;;
  Linux/x86_64)
    uv_target="x86_64-unknown-linux-gnu"
    uv_sha="f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645"
    gl_target="linux_x64"
    gl_sha="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Darwin/arm64)
    uv_target="aarch64-apple-darwin"
    uv_sha="60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472"
    gl_target="darwin_arm64"
    gl_sha="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  *)
    echo "Plataforma no soportada: ${os}/${arch}" >&2
    exit 1
    ;;
esac

sha256_check() {
  local file="$1" expected="$2" actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${file}" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "${file}" | cut -d' ' -f1)"
  fi
  if [[ "${actual}" != "${expected}" ]]; then
    echo "sha256 no coincide para ${file}: ${actual}" >&2
    exit 1
  fi
}

if [[ "$("${BIN}/uv" --version 2>/dev/null | cut -d' ' -f2)" != "${UV_VERSION}" ]]; then
  echo "Instalando uv ${UV_VERSION}"
  curl -fsSL -o "${TMP}/uv.tar.gz" \
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uv_target}.tar.gz"
  sha256_check "${TMP}/uv.tar.gz" "${uv_sha}"
  tar -xzf "${TMP}/uv.tar.gz" -C "${TMP}"
  install -m 0755 "${TMP}/uv-${uv_target}/uv" "${TMP}/uv-${uv_target}/uvx" "${BIN}/"
fi

if [[ "$("${BIN}/gitleaks" version 2>/dev/null)" != "${GITLEAKS_VERSION}" ]]; then
  echo "Instalando gitleaks ${GITLEAKS_VERSION}"
  curl -fsSL -o "${TMP}/gitleaks.tar.gz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${gl_target}.tar.gz"
  sha256_check "${TMP}/gitleaks.tar.gz" "${gl_sha}"
  tar -xzf "${TMP}/gitleaks.tar.gz" -C "${TMP}" gitleaks
  install -m 0755 "${TMP}/gitleaks" "${BIN}/gitleaks"
fi

"${BIN}/uv" --version
echo "gitleaks $("${BIN}/gitleaks" version)"
