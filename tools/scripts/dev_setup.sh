#!/usr/bin/env bash

set -euo pipefail

readonly repo_root="$(git rev-parse --show-toplevel)"
readonly python_version="3.8.1"

# OS detection
is_macos() {
  [[ "$OSTYPE" =~ ^darwin ]] || return 1
}
is_ubuntu() {
  [[ "$(cat /etc/issue 2> /dev/null)" =~ Ubuntu ]] || return 1
}

if is_macos; then
  brew install heroku python3 pyenv getsentry/tools/sentry-cli || true
  pyenv install "${python_version}" --skip-existing

  virtualenv_name="dancingtogether-${python_version}"
  pyenv virtualenv "${python_version}" "${virtualenv_name}" || true
  pyenv local "${virtualenv_name}"
elif is_ubuntu; then
  echo "You are on your own for installing python ${python_version}" 2>&1

  # Install heroku
  sudo add-apt-repository "deb https://cli-assets.heroku.com/branches/stable/apt ./"
  curl -L https://cli-assets.heroku.com/apt/release.key | sudo apt-key add -
  sudo apt-get update
  sudo apt-get install heroku sentry-cli || true
fi

git remote add heroku https://git.heroku.com/dancingtogether.git || true
ln -s -f "${repo_root}"/tools/scripts/git-hooks/pre-commit .git/hooks/pre-commit

pip3 install pipenv
pipenv install --dev
