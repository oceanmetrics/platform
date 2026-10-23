#!/bin/bash
# the fake of ~/.config/oceanmetrics/rclone-r2.sh: no env file, the fake rclone from PATH
exec rclone "$@"
