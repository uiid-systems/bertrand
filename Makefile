PREFIX ?= $(HOME)/.local/bin
PORT   ?= 7779
WEBDIR ?= $(CURDIR)/web/dist

build:
	cd web && pnpm build
	go build -o $(PREFIX)/bertrand .

dev: build
	-@pkill -f "bertrand serve" 2>/dev/null; true
	@echo "Dashboard running at http://127.0.0.1:$(PORT)"
	$(PREFIX)/bertrand serve --port $(PORT) --web-dir $(WEBDIR)

serve:
	trap 'kill %1 2>/dev/null' EXIT; \
	cd web && pnpm build && cd .. && \
	go run . serve --port $(PORT) --web-dir $(WEBDIR) & \
	cd web && pnpm dev

.PHONY: build dev serve
