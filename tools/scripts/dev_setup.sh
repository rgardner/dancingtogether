#!/usr/bin/env bash

set -euo pipefail

readonly repo_root="$(git rev-parse --show-toplevel)"

# OS detection
is_macos() {
  [[ "$OSTYPE" =~ ^darwin ]] || return 1
}
is_ubuntu() {
  [[ "$(cat /etc/issue 2> /dev/null)" =~ Ubuntu ]] || return 1
}
get_os() {
  for os in macos ubuntu; do
    "is_$os"; [[ $? == "${1:-0}" ]] && echo $os
  done
}

if is_macos; then
  brew install python3 || true
  brew install heroku || true
elif is_ubuntu; then
  # Install Python3.6
  sudo add-apt-repository ppa:jonathonf/python-3.6 || true
  sudo apt-get update
  sudo apt-get install python3.6 || true

  # Install heroku
  sudo add-apt-repository "deb https://cli-assets.heroku.com/branches/stable/apt ./"
  curl -L https://cli-assets.heroku.com/apt/release.key | sudo apt-key add -
  sudo apt-get update
  sudo apt-get install heroku || true
fi

git remote add heroku https://git.heroku.com/dancingtogether.git || true
ln -s -f "$repo_root"/tools/scripts/git-hooks/pre-commit .git/hooks/pre-commit

pip3 install pipenv
pipenv install --dev
