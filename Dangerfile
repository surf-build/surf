# Warn when there is a big PR
warn("Big PR") if lines_of_code > 500

# Don't let testing shortcuts get into master by accident
fail("describe.only left in tests") if `grep -r describe.only test/`.length > 1
fail("it.only left in tests") if `grep -r it.only test/ `.length > 1
