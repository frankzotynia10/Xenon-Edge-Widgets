# Homelab

Your Unraid servers at a glance, with internet ping.

Each server gets a card:
- **Status:** a dot that is green when the server is fine, amber when something needs a look (a disk, an unhealthy container, a failed read) and red when the server is offline.
- **Ping and uptime.**
- **Bars:** CPU, memory and array use. While a parity check runs, the array bar shows how far along it is.
- **Docker:** running out of total. On taller sizes, stopped and unhealthy containers are named.

The header shows ping to the internet, and to anything else you list.

| Size | Shows |
|---|---|
| S | Two servers side by side, without container names |
| M and taller | Bigger cards, with container names |
| Wide | Up to four servers in a row |

**Settings:** "Name stopped containers" and the accent color.

## Setup
The widget is fed by the Edge helper, which reads the servers every 10 seconds. List them in `homelab-edge/helper/config.json` (start from `config.example.json`; the file is git-ignored):

```json
{
  "every": 10,
  "servers": [
    { "name": "tower", "host": "tower", "via": "ssh", "user": "root" },
    { "name": "nas", "host": "192.168.1.20", "via": "api", "apiKey": "..." }
  ],
  "pings": [{ "name": "Internet", "host": "1.1.1.1" }]
}
```

Each server is read one of two ways:
- **`ssh`:** runs `helper/probe.sh` over SSH. `ssh user@host` must work from this PC without a password (an SSH key). Nothing is installed on the server.
- **`api`:** Unraid's built-in API (Unraid 7). Make a key in Unraid under Settings → Management Access → API Keys, with read access. `url` defaults to `http://<host>/graphql`. If the server redirects that to its https address (most do, e.g. `https://tower:443` or `:8443`), the helper follows it, but only to the same server name. Set `url` yourself if the API is somewhere else.

Both are read-only: nothing on the servers is changed. Changes to `config.json` are picked up within a minute.

## How it counts problems
A disk counts as a problem when its status isn't OK, apart from empty slots. An unused second parity slot is normal and isn't counted. (Unraid's own disabled/invalid counters do count it, so they would flag a healthy array.)
