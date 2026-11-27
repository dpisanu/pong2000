#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WEBSITE_DIR}/.." && pwd)"

REMOTE_NAME="${1:-origin}"
TARGET_BRANCH="${2:-gh-pages}"

if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: ${REPO_ROOT} is not a Git repository." >&2
  exit 1
fi

if ! git -C "${REPO_ROOT}" remote get-url "${REMOTE_NAME}" >/dev/null 2>&1; then
  echo "Error: Git remote '${REMOTE_NAME}' is not configured." >&2
  echo "Add one first with: git remote add origin <your-github-repo-url>" >&2
  exit 1
fi

echo "==> Typechecking website..."
npm --prefix "${REPO_ROOT}" run lint:website

echo "==> Building website static bundle into website/dist/..."
npm --prefix "${REPO_ROOT}" run build:website

DIST_DIR="${WEBSITE_DIR}/dist"
if [ ! -f "${DIST_DIR}/index.html" ]; then
  echo "Error: ${DIST_DIR}/index.html was not generated." >&2
  exit 1
fi

# Ensure .nojekyll exists so GitHub Pages serves bundled assets verbatim
touch "${DIST_DIR}/.nojekyll"

WORKTREE_DIR="$(mktemp -d)"
cleanup() {
  git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" >/dev/null 2>&1 || rm -rf "${WORKTREE_DIR}"
}
trap cleanup EXIT

echo "==> Preparing '${TARGET_BRANCH}' branch..."
if git -C "${REPO_ROOT}" ls-remote --exit-code --heads "${REMOTE_NAME}" "${TARGET_BRANCH}" >/dev/null 2>&1; then
  git -C "${REPO_ROOT}" fetch "${REMOTE_NAME}" "${TARGET_BRANCH}"
  git -C "${REPO_ROOT}" worktree add --detach "${WORKTREE_DIR}" "${REMOTE_NAME}/${TARGET_BRANCH}"
  git -C "${WORKTREE_DIR}" checkout -B "${TARGET_BRANCH}"
else
  git -C "${REPO_ROOT}" worktree add --orphan -b "${TARGET_BRANCH}" "${WORKTREE_DIR}"
fi

echo "==> Copying static bundle from website/dist/..."
find "${WORKTREE_DIR}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -a "${DIST_DIR}/." "${WORKTREE_DIR}/"

git -C "${WORKTREE_DIR}" add -A

if git -C "${WORKTREE_DIR}" diff --cached --quiet; then
  echo "==> No changes to deploy; '${TARGET_BRANCH}' is already up to date."
  exit 0
fi

COMMIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'local')"
git -C "${WORKTREE_DIR}" commit -m "Deploy Pong2000 website (${COMMIT_SHA})"

echo "==> Pushing '${TARGET_BRANCH}' to '${REMOTE_NAME}'..."
git -C "${WORKTREE_DIR}" push -u "${REMOTE_NAME}" "${TARGET_BRANCH}" --force

echo "==> Deployment complete."
