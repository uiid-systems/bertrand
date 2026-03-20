PREFIX ?= $(HOME)/.local/bin
PORT   ?= 7779

build:
	cd web && pnpm build
	go build -o $(PREFIX)/bertrand .

dev: build
	-@pkill -f "bertrand serve --port $(PORT)" 2>/dev/null; true
	$(PREFIX)/bertrand serve --port $(PORT) &
	@echo "Dashboard running at http://127.0.0.1:$(PORT)"

serve:
	go run . serve --port $(PORT) &
	cd web && pnpm dev

.PHONY: build dev serve
