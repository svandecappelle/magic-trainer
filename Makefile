# Magic Trainer: install and run on a server with Docker, behind nginx.
#
#   sudo make install DOMAIN=magic.example.com             # container + nginx site
#   sudo make install DOMAIN=magic.example.com HTTPS=1     # … and HTTPS (Let's Encrypt, webroot challenge)
#   make help                                              # everything else
#
# The nginx site is a single dedicated file, magic-trainer.host.conf. The installer only ever
# writes or removes that file (and its sites-enabled link): other sites are never touched.

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.ONESHELL:
.DEFAULT_GOAL := help

DOMAIN ?=
# Host port the container listens on (127.0.0.1 only), proxied by nginx.
PORT ?= 8787
# HTTPS=1: get a certificate with certbot (certonly --webroot: no certbot nginx plugin needed).
# EMAIL: account e-mail for Let's Encrypt (else certbot asks).
HTTPS ?= 0
EMAIL ?=
# FORCE=1: install even if another nginx site already uses DOMAIN.
FORCE ?= 0

SITE := magic-trainer.host.conf
TEMPLATE := deploy/$(SITE)
TEMPLATE_HTTPS := deploy/magic-trainer.host.https.conf
NGINX_ROOT ?= /etc/nginx
# Where certbot puts the challenge files, and where it keeps the certificate.
WEBROOT ?= /var/www/magic-trainer-acme
LETSENCRYPT ?= /etc/letsencrypt
# Commands, overridable (e.g. NGINX_RELOAD="nginx -s reload" without systemd).
SUDO ?= $(shell [ "$$(id -u)" = 0 ] || echo sudo)
COMPOSE ?= docker compose
NGINX_TEST ?= nginx -t
NGINX_DUMP ?= nginx -T
NGINX_RELOAD ?= systemctl reload nginx
CERTBOT ?= certbot

# Debian/Ubuntu layout (sites-available + sites-enabled link) when nginx.conf includes sites-enabled,
# conf.d otherwise (a sites-available folder alone is not loaded by every nginx package).
define nginx_paths
if [ -d "$(NGINX_ROOT)/sites-available" ] && grep -Eqs '^[[:space:]]*include[[:space:]]+[^;]*sites-enabled' "$(NGINX_ROOT)/nginx.conf"; then
  avail="$(NGINX_ROOT)/sites-available/$(SITE)"; enabled="$(NGINX_ROOT)/sites-enabled/$(SITE)"
else
  avail="$(NGINX_ROOT)/conf.d/$(SITE)"; enabled=""
fi
endef

.PHONY: help install app nginx https update uninstall status logs

help:
	@cat <<'EOF'
	Magic Trainer server installer

	  sudo make install DOMAIN=magic.example.com [HTTPS=1] [EMAIL=you@example.com] [PORT=8787]
	      Build and start the container, install the nginx site $(SITE), reload nginx.
	  make app [PORT=8787]                  Build and (re)start the container only.
	  sudo make nginx DOMAIN=…              Install or update the nginx site only.
	  sudo make https DOMAIN=… [EMAIL=…]    Get the HTTPS certificate (certbot, webroot) and switch the site to HTTPS.
	  make update                           git pull, rebuild and restart the container.
	  make status / make logs               Container state / follow its logs.
	  sudo make uninstall                   Stop the container and remove the nginx site (only $(SITE)).
	EOF

install: app nginx
	@if [ "$(HTTPS)" = 1 ]; then $(MAKE) --no-print-directory https; fi
	echo
	echo "Magic Trainer is installed: http$$([ "$(HTTPS)" = 1 ] && echo s)://$(DOMAIN)/"

# ---------- Container ----------

app:
	@command -v docker >/dev/null || { echo "Docker is not installed: https://docs.docker.com/engine/install/" >&2; exit 1; }
	$(COMPOSE) version >/dev/null || { echo "The Docker compose plugin is missing (package docker-compose-plugin)." >&2; exit 1; }
	echo "Building and starting the container on 127.0.0.1:$(PORT)…"
	MAGIC_TRAINER_PORT=$(PORT) $(COMPOSE) up -d --build
	# Wait until the app answers (the image runs the tests while building, so this is quick).
	for i in $$(seq 1 30); do
	  if curl -fsS -o /dev/null "http://127.0.0.1:$(PORT)/" 2>/dev/null; then echo "The app answers on port $(PORT)."; exit 0; fi
	  sleep 2
	done
	echo "The app does not answer on port $(PORT) yet: check 'make logs'." >&2
	exit 1

update:
	@git pull --ff-only
	$(MAKE) --no-print-directory app

status:
	@$(COMPOSE) ps

logs:
	@$(COMPOSE) logs -f --tail=100

# ---------- nginx ----------

nginx:
	@[ -n "$(DOMAIN)" ] || { echo "Set the domain: make nginx DOMAIN=magic.example.com" >&2; exit 1; }
	[[ "$(DOMAIN)" =~ ^[A-Za-z0-9.-]+$$ ]] || { echo "Invalid domain: $(DOMAIN)" >&2; exit 1; }
	[[ "$(PORT)" =~ ^[0-9]+$$ ]] || { echo "Invalid port: $(PORT)" >&2; exit 1; }
	[ -d "$(NGINX_ROOT)" ] || { echo "nginx is not installed ($(NGINX_ROOT) missing): sudo apt install nginx" >&2; exit 1; }
	$(nginx_paths)
	# Another site already serving this domain would conflict: stop unless FORCE=1.
	others=$$(grep -rlE "server_name[^;]*[[:space:]]$(subst .,\.,$(DOMAIN))([[:space:];]|$$)" "$(NGINX_ROOT)" 2>/dev/null | grep -v "$(SITE)" || true)
	if [ -n "$$others" ] && [ "$(FORCE)" != 1 ]; then
	  echo "Another nginx configuration already uses $(DOMAIN):" >&2; echo "$$others" >&2
	  echo "Nothing was changed. Use another domain, or FORCE=1 to install anyway." >&2; exit 1
	fi
	# HTTPS once a certificate exists for the domain (make https), plain HTTP before.
	cert="$(LETSENCRYPT)/live/$(DOMAIN)"
	if $(SUDO) test -f "$$cert/fullchain.pem"; then template="$(TEMPLATE_HTTPS)"; mode=https; else template="$(TEMPLATE)"; mode=http; fi
	$(SUDO) mkdir -p "$(WEBROOT)"
	rendered=$$(mktemp); trap 'rm -f "$$rendered"' EXIT
	sed -e "s/__DOMAIN__/$(DOMAIN)/g" -e "s/__PORT__/$(PORT)/g" -e "s|__WEBROOT__|$(WEBROOT)|g" -e "s|__CERT_DIR__|$$cert|g" "$$template" > "$$rendered"
	# Keep the previous version of our own file, to restore it if the new one is rejected.
	backup=""
	if [ -f "$$avail" ]; then
	  backup="$$avail.bak-$$(date +%Y%m%d%H%M%S)"
	  $(SUDO) cp -p "$$avail" "$$backup"
	fi
	$(SUDO) install -m 644 "$$rendered" "$$avail"
	if [ -n "$$enabled" ]; then $(SUDO) ln -sfn "$$avail" "$$enabled"; fi
	# Our own file in the other layout (left by an earlier install) would load the site twice: remove it.
	for old in "$(NGINX_ROOT)/sites-available/$(SITE)" "$(NGINX_ROOT)/sites-enabled/$(SITE)" "$(NGINX_ROOT)/conf.d/$(SITE)"; do
	  if [ "$$old" != "$$avail" ] && [ "$$old" != "$$enabled" ] && { [ -e "$$old" ] || [ -L "$$old" ]; }; then $(SUDO) rm -f "$$old"; echo "Removed the old copy $$old"; fi
	done
	echo "Installed $$avail"
	if ! $(SUDO) $(NGINX_TEST); then
	  echo "nginx rejected the configuration: restoring the previous state." >&2
	  if [ -n "$$backup" ]; then $(SUDO) cp -p "$$backup" "$$avail"
	  else $(SUDO) rm -f "$$avail"; if [ -n "$$enabled" ]; then $(SUDO) rm -f "$$enabled"; fi; fi
	  exit 1
	fi
	$(SUDO) $(NGINX_RELOAD)
	# Make sure nginx really loads the file (an include missing from nginx.conf would silently ignore it).
	if ! $(SUDO) $(NGINX_DUMP) 2>/dev/null | grep -q "^# configuration file .*$(SITE):"; then
	  echo "Warning: nginx does not load $$avail. Add an include for its folder to the http block of $(NGINX_ROOT)/nginx.conf." >&2
	  exit 1
	fi
	echo "nginx reloaded ($$mode): $$mode://$(DOMAIN)/ → 127.0.0.1:$(PORT)"

https:
	@[ -n "$(DOMAIN)" ] || { echo "Set the domain: make https DOMAIN=magic.example.com" >&2; exit 1; }
	command -v $(firstword $(CERTBOT)) >/dev/null || { echo "certbot is not installed: sudo apt install certbot" >&2; exit 1; }
	# 1. The site must answer the challenge over HTTP: (re)install it (HTTP, or HTTPS if a certificate exists).
	$(MAKE) --no-print-directory nginx
	# 2. Get the certificate: certbot writes the challenge into the site's own folder, nothing else is touched.
	#    The deploy hook reloads nginx after each renewal (certbot renews automatically with its timer).
	$(SUDO) $(CERTBOT) certonly --webroot -w "$(WEBROOT)" -d "$(DOMAIN)" --cert-name "$(DOMAIN)" --keep-until-expiring \
	  --deploy-hook "$(NGINX_RELOAD)" $(if $(EMAIL),--non-interactive --agree-tos -m $(EMAIL),)
	# 3. Switch the site to HTTPS.
	$(MAKE) --no-print-directory nginx

uninstall:
	@$(nginx_paths)
	if [ -f "$$avail" ] || [ -L "$${enabled:-/nonexistent}" ]; then
	  $(SUDO) rm -f "$$avail"
	  if [ -n "$$enabled" ]; then $(SUDO) rm -f "$$enabled"; fi
	  if $(SUDO) $(NGINX_TEST); then $(SUDO) $(NGINX_RELOAD); fi
	  echo "Removed $$avail (backups $(SITE).bak-* are kept; the certificate, if any, too)."
	fi
	if command -v docker >/dev/null; then $(COMPOSE) down; fi
	echo "Magic Trainer is uninstalled."
