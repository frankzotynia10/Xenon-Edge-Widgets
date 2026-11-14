# Read-only status of an Unraid server, run over SSH by the Homelab helper. Sections start with @name.
echo "@cpu"; head -1 /proc/stat; sleep 1; head -1 /proc/stat
echo "@mem"; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
echo "@up"; cut -d' ' -f1 /proc/uptime
echo "@array"; grep -E '^(mdState|mdNumDisabled|mdNumInvalid|mdNumMissing|mdResync|mdResyncPos|mdResyncSize|mdResyncAction)=' /var/local/emhttp/var.ini 2>/dev/null
echo "@disks"; awk -F= '/^name=/{n=$2} /^status=/{print n" "$2}' /var/local/emhttp/disks.ini 2>/dev/null
echo "@df"; df -B1 --output=size,used /mnt/user 2>/dev/null | tail -1
echo "@docker"; docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null
echo "@end"
