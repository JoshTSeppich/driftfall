#!/bin/zsh
# QA Lead helper: run each test file on its own with a timeout and print one line per file.
cd /Users/joshuaseppich/dev/rts || exit 1
for f in tests/*.test.mjs; do
  s=$(date +%s)
  out=$(timeout 90 node --test "$f" 2>&1)
  code=$?
  e=$(date +%s)
  p=$(echo "$out" | grep -E "^# pass" | awk '{print $3}')
  fl=$(echo "$out" | grep -E "^# fail" | awk '{print $3}')
  echo "$f exit=$code pass=$p fail=$fl secs=$((e-s))"
done
