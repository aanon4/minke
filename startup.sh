#! /bin/sh

# Setup timezone
if [ ! -s /etc/timezone ]; then
  if [ "${TZ}" != "" ]; then
    echo ${TZ} > /etc/timezone
  else
    echo 'America/Los_Angeles' > /etc/timezone
  fi
fi
cp /usr/share/zoneinfo/$(cat /etc/timezone) /etc/localtime

# Start syncing time. Delay this for 60 seconds to give the MinkeBox DNS time to startup.
echo "servers pool.ntp.org" > /etc/ntpd.conf
(sleep 60 ; ntpd -s -f /etc/ntpd.conf) &

# MinkeBox
/usr/bin/node --expose-gc /app/index.js
# Restart if testing (so we can debug inside the docker container)
while [ -f /tmp/minke-testing ]; do
  /usr/bin/node --expose-gc /app/index.js
done
