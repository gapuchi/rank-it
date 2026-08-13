default:
    @just --list

alias i := install
alias s := serve
alias d := dev
alias r := rank-it

install:
    npm ci

serve:
    npm run serve

dev:
    npm run dev

rank-it *args:
    npm run rank-it -- {{ args }}
