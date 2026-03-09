PREFIX ?= $(HOME)/.local/bin

build:
	go build -o $(PREFIX)/bertrand .

.PHONY: build
