import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, Group, Stack, Text } from "@uiid/design-system";
import { AArrowDownIcon, AArrowUpIcon } from "@uiid/icons";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { wsUrl } from "../../api/base";
import {
  DEFAULT_FONT_SIZE,
  FALLBACK_DIMS,
  proposeDims,
  sameDims,
  type Dims,
} from "./geometry";
import { useTerminalFontSize } from "./use-terminal-font-size";

/**
 * A live session's PTY, rendered wherever it is placed.
 *
 * Drives `/ws/sessions/:id/terminal?role=browser` (src/server/terminal-relay.ts):
 * output goes through xterm.js because the PTY emits ANSI and a TUI redraws in
 * place, and input comes from `term.onData`, which already emits exactly what a
 * tty would (CR for Enter, `\x03` for Ctrl+C, escape sequences for arrows) so
 * there is no key translation to get wrong.
 *
 * **Sizing.** This behaves like a terminal window: the font size never changes,
 * and resizing the box changes how many rows and columns fit, which the attached
 * program reflows into. The component owns no layout assumptions — it fills the
 * box it is given, watches it with a ResizeObserver, and re-derives the grid —
 * so the same component works in a resizable panel, a dialog, a drawer, a
 * sidebar zone, or a phone-width viewport. See ./geometry.ts.
 *
 * Because the PTY is shared with the local terminal, the new grid is a *claim*
 * rather than a command: upstream applies the smaller of the claim and its own
 * terminal per axis and reports what took effect. The emulator renders that
 * reported geometry, so a box wider than the local terminal shows unused margin
 * instead of a grid the local terminal would have to wrap.
 *
 * **Lifetime.** The socket is tied to this component, so unmounting detaches
 * (which also releases the claim, returning the PTY to the local terminal's
 * size). That is deliberate — several sessions can be live at once, and a
 * terminal that outlived the view it was opened from would show a different
 * session's PTY than the surrounding page.
 */

export type TerminalStatus = "connecting" | "attached" | "detached";

export interface SessionTerminalState {
  status: TerminalStatus;
  /** Geometry upstream reports for the PTY, or null before it has said. */
  dims: Dims | null;
  /** Grid this box asked for, which upstream may cap to the local terminal. */
  claim: Dims | null;
}

/**
 * Observable facts about scrolling, for the dev harness. Scroll behavior depends
 * on things that aren't visible from the outside — whether the program is on the
 * alternate screen (where no scrollback exists), whether any scrollback has
 * accumulated, and whether wheel events reach xterm's hook at all — so these are
 * surfaced rather than guessed at.
 */
export interface TerminalDiagnostics {
  /**
   * On the alternate screen the program owns the whole display and there is no
   * scrollback — scrolling is the program's to do, via mouse or key sequences,
   * exactly as in a real terminal.
   */
  bufferType: "normal" | "alternate";
  /** Total buffer lines, including scrollback. Equal to `rows` means no history. */
  bufferLength: number;
  rows: number;
  cols: number;
  viewportScrollHeight: number;
  viewportClientHeight: number;
  /** Wheel events seen at the container (capture phase). */
  hostWheelEvents: number;
  /** Wheel events that reached xterm, which does the actual scrolling. */
  xtermWheelEvents: number;
  /**
   * Socket state, because a closed one silently drops every keystroke: `onData`
   * only sends while the socket is OPEN, so a dead socket looks exactly like a
   * terminal that ignores typing.
   */
  socketState: "connecting" | "open" | "closing" | "closed" | "none";
  /** Whether xterm holds focus — without it, keystrokes never reach `onData`. */
  focused: boolean;
  /** Reconnect attempts so far; climbing means the socket won't stay up. */
  retries: number;
}

export type SessionTerminalProps = {
  /** Session whose PTY to attach to. Changing it reattaches and clears. */
  sessionId: string;
  /** Lets a host render its own status chrome instead of `toolbar`. */
  onStateChange?: (state: SessionTerminalState) => void;
  /** Scroll internals, for the dev harness. Not used by the session view. */
  onDiagnostics?: (diagnostics: TerminalDiagnostics) => void;
  /** Built-in status bar. Turn off when the host provides its own. */
  toolbar?: boolean;
};

/**
 * Reconnect backoff. The relay lives in `bertrand serve`, which restarts often
 * enough in normal use (upgrades, session lifecycle) that silently going dead is
 * worse than a few retries — but this is not the durable reconnect/restore work
 * docs/pty-wrapper.md defers, just enough to survive a blip.
 */
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/**
 * How long the grid has to hold still before the PTY is asked to match it.
 *
 * The local emulator reflows immediately (that's what a terminal window does),
 * but a claim resizes a real PTY and makes the attached TUI repaint, so
 * streaming one per column crossed while a panel is being dragged would thrash
 * the terminal the session is actually attached to. Trailing-only, so a settled
 * drag resizes the PTY exactly once.
 */
const CLAIM_DEBOUNCE_MS = 120;

/**
 * Grace period after the grid settles before asking for a redraw — long enough
 * that a TUI repainting on its own gets there first and the request is a no-op
 * rather than a second redraw on top of the first.
 */
const REPAINT_DELAY_MS = 250;

export const SessionTerminal = ({
  sessionId,
  onStateChange,
  onDiagnostics,
  toolbar = true,
}: SessionTerminalProps) => {
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [dims, setDims] = useState<Dims | null>(null);
  const [claim, setClaim] = useState<Dims | null>(null);
  const { fontSize } = useTerminalFontSize();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<IDisposable | null>(null);
  const dimsRef = useRef<Dims | null>(null);
  const claimRef = useRef<Dims | null>(null);
  const frameRef = useRef<number | null>(null);
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repaintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repaintedForRef = useRef<Dims | null>(null);
  // Held in a ref and read through one, so the terminal isn't recreated when the
  // consumer passes a new callback identity.
  const onDiagnosticsRef = useRef(onDiagnostics);
  onDiagnosticsRef.current = onDiagnostics;
  const diagnosticsRef = useRef({
    hostWheelEvents: 0,
    xtermWheelEvents: 0,
    retries: 0,
  });

  /**
   * Asks upstream to redraw once the geometry has settled.
   *
   * A PTY resize makes the TUI repaint on its own, but xterm reflows its existing
   * buffer into the new grid first, so the visible frame is a re-wrapped version
   * of the pre-resize one until that redraw lands. Requesting a repaint makes the
   * clean frame guaranteed rather than dependent on the program's own timing.
   *
   * Guarded to one request per distinct geometry: upstream answers a repaint by
   * resizing twice in quick succession, and repainting again for that would not
   * terminate.
   */
  const repaintLater = useCallback((forDims: Dims) => {
    if (sameDims(forDims, repaintedForRef.current)) return;
    if (repaintTimerRef.current) clearTimeout(repaintTimerRef.current);
    repaintTimerRef.current = setTimeout(() => {
      repaintTimerRef.current = null;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      repaintedForRef.current = forDims;
      socket.send(JSON.stringify({ t: "repaint" }));
    }, REPAINT_DELAY_MS);
  }, []);

  /**
   * Sends the grid this box wants, once it has settled. Kept separate from the
   * emulator resize so the local view stays responsive during a drag while the
   * PTY is only disturbed at the end of one.
   */
  const claimLater = useCallback((next: Dims, immediate = false) => {
    if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    const flush = () => {
      claimTimerRef.current = null;
      if (sameDims(next, claimRef.current)) return;
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      claimRef.current = next;
      setClaim(next);
      socket.send(JSON.stringify({ t: "claim", ...next }));
    };
    // On attach there is nothing to debounce and every millisecond of waiting is
    // a millisecond of replayed output rendered at the wrong grid, so claim now.
    if (immediate) flush();
    else claimTimerRef.current = setTimeout(flush, CLAIM_DEBOUNCE_MS);
  }, []);

  /**
   * Claims the grid this box wants and renders the grid upstream reports.
   *
   * Those are deliberately two different things. The emulator's grid must always
   * equal the PTY's, never a prediction of it: a TUI addresses the cursor
   * absolutely against the size it was told, so a grid that is off by even one
   * column turns every wrapped line and cursor move into garbage. Rendering the
   * claim optimistically — before upstream has resized — produced exactly that,
   * and the relay's attach replay (captured at the old grid) made it persistent.
   *
   * So: propose → claim → wait for `{t:"dims"}` → resize. The cost is that a
   * resize isn't reflected until the round trip completes, which is the same
   * latency a terminal emulator has against a remote shell.
   */
  const applyFit = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;

    // A collapsed or not-yet-laid-out box has no grid to derive.
    if (host.clientWidth >= 8 && host.clientHeight >= 8) {
      const proposed = proposeDims(fit);
      if (proposed && !sameDims(proposed, claimRef.current)) claimLater(proposed);
    }

    const reported = dimsRef.current ?? FALLBACK_DIMS;
    if (term.cols !== reported.cols || term.rows !== reported.rows) {
      term.resize(reported.cols, reported.rows);
    }
  }, [claimLater]);

  /** Coalesces bursts of resize notifications into one fit per frame. */
  const scheduleFit = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      applyFit();
    });
  }, [applyFit]);

  // Create the emulator once and watch its box. The terminal outlives
  // reconnects and session changes; only its contents are reset.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      // Set once here; changes are applied by the effect below rather than by
      // recreating the terminal, which would drop the session's scrollback.
      fontSize: DEFAULT_FONT_SIZE,
      scrollback: 5000,
      // Terminals are conventionally dark and Claude Code's ANSI palette is
      // tuned for a dark background, so this surface stays dark in both themes.
      theme: { background: "#0b0b0c", foreground: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    const SOCKET_STATES = ["connecting", "open", "closing", "closed"] as const;
    const reportDiagnostics = () => {
      const report = onDiagnosticsRef.current;
      if (!report) return;
      const viewport = host.querySelector<HTMLElement>(".xterm-viewport");
      const socket = socketRef.current;
      report({
        bufferType: term.buffer.active.type,
        bufferLength: term.buffer.active.length,
        rows: term.rows,
        cols: term.cols,
        viewportScrollHeight: viewport?.scrollHeight ?? 0,
        viewportClientHeight: viewport?.clientHeight ?? 0,
        socketState: socket ? SOCKET_STATES[socket.readyState] ?? "closed" : "none",
        focused: host.contains(document.activeElement),
        ...diagnosticsRef.current,
      });
    };
    // Buffer length grows with output, not with events we control, so the harness
    // needs a poll to show it live. Only runs when someone is watching.
    const diagnosticsTimer = onDiagnosticsRef.current
      ? setInterval(reportDiagnostics, 500)
      : null;

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);
    scheduleFit();

    /**
     * Scrolling is xterm's job, not ours — this hook only counts events.
     *
     * Returning `false` here makes xterm `return` before it does any of its own
     * wheel handling (CoreBrowserTerminal, both the mouse-reporting path and the
     * viewport path), which is how an earlier attempt at "fixing" scrolling broke
     * it outright. xterm already covers every case correctly:
     *
     *   - the program requested mouse events: the wheel becomes a mouse wheel
     *     event sent to the program, which is how a full-screen TUI scrolls;
     *   - alternate screen with no mouse reporting: xterm converts the wheel into
     *     up/down sequences, explicitly so apps in the alt buffer still scroll;
     *   - normal buffer with scrollback: it scrolls its own viewport.
     *
     * It cancels the event in each of those, so nothing chains to the page. There
     * is no case left for us to handle, and intercepting can only take one away.
     */
    term.attachCustomWheelEventHandler(() => {
      diagnosticsRef.current.xtermWheelEvents += 1;
      return true;
    });

    const countWheel = () => {
      diagnosticsRef.current.hostWheelEvents += 1;
    };
    host.addEventListener("wheel", countWheel, {
      capture: true,
      passive: true,
    });

    // Backstop for focus: xterm focuses itself when its screen is clicked, but the
    // click can land on padding or the letterboxed margin outside it, which would
    // otherwise leave the terminal unfocused and silently ignoring keystrokes.
    const onPointerDown = () => term.focus();
    host.addEventListener("pointerdown", onPointerDown);

    return () => {
      if (diagnosticsTimer) clearInterval(diagnosticsTimer);
      host.removeEventListener("wheel", countWheel, { capture: true });
      host.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [scheduleFit]);

  // Attach to the session's PTY, reattaching when the session changes.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !sessionId) return;

    let disposed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (disposed) return;
      setStatus("connecting");

      const socket = new WebSocket(
        wsUrl(`/ws/sessions/${sessionId}/terminal?role=browser`),
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        retry = 0;
        setStatus("attached");
        // Without focus, keystrokes never reach `onData` and the terminal looks
        // attached but dead. Focusing on attach is what the original dev page did
        // and dropping it in the extraction was a regression.
        term.focus();
        // A claim does not survive a dropped socket, so re-assert it — and do it
        // now rather than on the debounce, so upstream is already resizing while
        // the attach replay arrives.
        claimRef.current = null;
        const fit = fitRef.current;
        const host = hostRef.current;
        if (fit && host && host.clientWidth >= 8 && host.clientHeight >= 8) {
          const proposed = proposeDims(fit);
          if (proposed) claimLater(proposed, true);
        }
        scheduleFit();
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const frame = JSON.parse(event.data);
            if (
              frame?.t === "dims" &&
              typeof frame.cols === "number" &&
              typeof frame.rows === "number"
            ) {
              const next = { cols: frame.cols, rows: frame.rows };
              if (sameDims(next, dimsRef.current)) return;
              const isFirst = dimsRef.current === null;
              dimsRef.current = next;
              setDims(next);
              scheduleFit();
              // The relay already asks for a repaint when a browser attaches, so
              // the first geometry needs no request — only later changes do.
              if (isFirst) repaintedForRef.current = next;
              else repaintLater(next);
            }
          } catch {
            // Ignore malformed control frames.
          }
          return;
        }
        // Hand the emulator raw bytes — it decodes UTF-8 across chunk
        // boundaries itself, so there's no partial-codepoint handling here.
        term.write(new Uint8Array(event.data as ArrayBuffer));
      };

      socket.onclose = () => {
        socketRef.current = null;
        claimRef.current = null;
        if (disposed) return;
        setStatus("detached");
        // Keep trying indefinitely at the capped backoff. Giving up left a
        // terminal that looked attached but silently dropped every keystroke,
        // with no way to recover short of navigating away.
        const delay =
          RETRY_DELAYS_MS[Math.min(retry, RETRY_DELAYS_MS.length - 1)]!;
        retry += 1;
        diagnosticsRef.current.retries = retry;
        retryTimer = setTimeout(open, delay);
      };
    };

    term.reset();
    dimsRef.current = null;
    setDims(null);
    open();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      // Work queued mid-drag must not land on the next session's socket.
      if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
      claimTimerRef.current = null;
      if (repaintTimerRef.current) clearTimeout(repaintTimerRef.current);
      repaintTimerRef.current = null;
      repaintedForRef.current = null;
      // Closing implies unclaim server-side, so the PTY returns to the local
      // terminal's size on its own.
      socketRef.current?.close();
      socketRef.current = null;
      claimRef.current = null;
    };
  }, [sessionId, scheduleFit, claimLater, repaintLater]);

  // Keystrokes: bound once, reading the socket through a ref so reconnects
  // don't need to rebind.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const encoder = new TextEncoder();
    inputRef.current = term.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(encoder.encode(data));
      }
    });
    return () => {
      inputRef.current?.dispose();
      inputRef.current = null;
    };
  }, [sessionId]);

  // A font size change doesn't rescale a fixed grid — it changes how many cells
  // fit the same panel, so it re-derives the grid and re-claims, exactly like
  // changing font size in a terminal app.
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    scheduleFit();
  }, [fontSize, scheduleFit]);

  useEffect(() => {
    onStateChange?.({ status, dims, claim });
  }, [onStateChange, status, dims, claim]);

  return (
    <Stack ax="stretch" fullwidth fullheight style={{ minHeight: 0 }}>
      {toolbar && <TerminalToolbar status={status} dims={dims} claim={claim} />}
      {/*
        The emulator's box. The grid is derived from this element's size, so it
        is the measurement surface as well as the render surface; `overflow:
        hidden` keeps a mid-resize frame from ever spilling into the surrounding
        layout.
      */}
      <div
        ref={hostRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "#0b0b0c",
        }}
      />
    </Stack>
  );
};
SessionTerminal.displayName = "SessionTerminal";

const STATUS_COLOR = {
  attached: "green",
  connecting: "yellow",
  detached: "neutral",
} as const;

/**
 * Font size controls, styled to match the timeline zone's jump-to-top/bottom
 * arrows (`xsmall` ghost squares with 13px icons) so the two zone headers read as
 * the same family. Exported for hosts rendering their own zone chrome.
 */
export const TerminalFontSizeControls = () => {
  const { fontSize, setFontSize, canDecrease, canIncrease } =
    useTerminalFontSize();

  return (
    <Group gap={1} ay="center" onClick={(e) => e.stopPropagation()}>
      <Button
        size="xsmall"
        variant="ghost"
        shape="square"
        disabled={!canDecrease}
        aria-label="Decrease terminal font size"
        tooltip={`Smaller text (${fontSize}px)`}
        onClick={() => setFontSize(fontSize - 1)}
      >
        <AArrowDownIcon size={13} />
      </Button>
      <Button
        size="xsmall"
        variant="ghost"
        shape="square"
        disabled={!canIncrease}
        aria-label="Increase terminal font size"
        tooltip={`Larger text (${fontSize}px)`}
        onClick={() => setFontSize(fontSize + 1)}
      >
        <AArrowUpIcon size={13} />
      </Button>
    </Group>
  );
};
TerminalFontSizeControls.displayName = "TerminalFontSizeControls";

export type TerminalToolbarProps = SessionTerminalState;

/**
 * Status line. Exported so a host that hides the built-in bar
 * (`toolbar={false}`) can present the same information in its own chrome from
 * `onStateChange`. Shows the claim alongside the applied geometry only when they
 * differ, which is the one case that needs explaining: the local terminal is
 * smaller than this box, so the extra space is unused.
 */
export const TerminalToolbar = ({ status, dims, claim }: TerminalToolbarProps) => {
  const capped = dims && claim && !sameDims(dims, claim);
  return (
    <Group ay="center" gap={2} px={2} py={1} fullwidth>
      <Badge color={STATUS_COLOR[status]}>{status}</Badge>
      {dims && (
        <Text size={0} shade="muted" family="mono">
          {dims.cols}×{dims.rows}
        </Text>
      )}
      {capped && (
        <Text size={0} shade="muted">
          capped by the local terminal (this panel fits {claim.cols}×{claim.rows})
        </Text>
      )}
      <Group ml="auto">
        <TerminalFontSizeControls />
      </Group>
    </Group>
  );
};
TerminalToolbar.displayName = "TerminalToolbar";
