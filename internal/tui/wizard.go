package tui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type wizardStep int

const (
	stepTerminal wizardStep = iota
	stepFocusQueue
	stepHammerspoonPath
	stepCustomPath
	stepDone
)

type WizardChoice struct {
	Terminal         string
	EnableFocusQueue bool
	HammerspoonPath  string
}

type WizardModel struct {
	step      wizardStep
	cursor    int
	choice    WizardChoice
	quitting  bool
	showLogo  bool
	pathInput textinput.Model
	width     int
}

func newPathInput() textinput.Model {
	ti := textinput.New()
	ti.Placeholder = "~/.hammerspoon"
	ti.Prompt = "  ❯ "
	ti.PromptStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("114")).Bold(true)
	ti.TextStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	ti.PlaceholderStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	ti.CharLimit = 120
	return ti
}

func NewWizardModel() WizardModel {
	return WizardModel{
		choice:    WizardChoice{HammerspoonPath: "~/.hammerspoon"},
		showLogo:  true,
		pathInput: newPathInput(),
	}
}

func NewWizardModelNoLogo() WizardModel {
	return WizardModel{
		choice:    WizardChoice{HammerspoonPath: "~/.hammerspoon"},
		showLogo:  false,
		pathInput: newPathInput(),
	}
}

func (m WizardModel) Choice() WizardChoice { return m.choice }
func (m WizardModel) Quitting() bool       { return m.quitting }

var (
	promptStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("120"))
	checkStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
	optionStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	cursorStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("114"))
	hintStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

var terminals = []string{"Warp", "iTerm2", "Terminal.app"}
var focusOptions = []string{"Yes, install config", "Skip for now"}
var pathOptions = []string{"~/.hammerspoon (default)", "Custom path"}

func (m WizardModel) Init() tea.Cmd { return nil }

func (m WizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		// Custom path input mode
		if m.step == stepCustomPath {
			switch msg.String() {
			case "ctrl+c":
				m.quitting = true
				return m, tea.Quit
			case "esc":
				// Go back to path selection
				m.step = stepHammerspoonPath
				m.cursor = 1
				return m, nil
			case "enter":
				val := m.pathInput.Value()
				if val == "" {
					val = "~/.hammerspoon"
				}
				m.choice.HammerspoonPath = val
				m.step = stepDone
				return m, tea.Quit
			}
			var cmd tea.Cmd
			m.pathInput, cmd = m.pathInput.Update(msg)
			return m, cmd
		}

		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			max := m.maxForStep()
			if m.cursor < max-1 {
				m.cursor++
			}
		case "enter":
			switch m.step {
			case stepTerminal:
				m.choice.Terminal = terminals[m.cursor]
				m.step = stepFocusQueue
				m.cursor = 0
			case stepFocusQueue:
				m.choice.EnableFocusQueue = m.cursor == 0
				if m.choice.EnableFocusQueue {
					m.step = stepHammerspoonPath
					m.cursor = 0
				} else {
					m.step = stepDone
					return m, tea.Quit
				}
			case stepHammerspoonPath:
				if m.cursor == 0 {
					m.choice.HammerspoonPath = "~/.hammerspoon"
					m.step = stepDone
					return m, tea.Quit
				}
				// Custom path → switch to text input
				m.step = stepCustomPath
				m.pathInput.Focus()
				return m, textinput.Blink
			}
		}
	}
	return m, nil
}

func renderOptions(options []string, cursor int) string {
	s := ""
	for i, o := range options {
		if i == cursor {
			s += fmt.Sprintf("  %s %s\n", cursorStyle.Render("❯"), optionStyle.Bold(true).Render(o))
		} else {
			s += fmt.Sprintf("    %s\n", hintStyle.Render(o))
		}
	}
	return s
}

func (m WizardModel) maxForStep() int {
	switch m.step {
	case stepTerminal:
		return len(terminals)
	case stepFocusQueue:
		return len(focusOptions)
	case stepHammerspoonPath:
		return len(pathOptions)
	}
	return 0
}

func (m WizardModel) View() string {
	if m.quitting {
		return ""
	}

	s := ""
	if m.showLogo {
		s = Logo()
	}
	s += "\n" + StatusBar(StatusBarData{}, m.width)

	switch m.step {
	case stepTerminal:
		s += promptStyle.Render("? Select your terminal:") + "\n\n"
		s += renderOptions(terminals, m.cursor)
	case stepFocusQueue:
		s += checkStyle.Render("  ✓ Terminal: "+m.choice.Terminal) + "\n\n"
		s += promptStyle.Render("? Enable focus queue? (requires Hammerspoon)") + "\n\n"
		s += renderOptions(focusOptions, m.cursor)
	case stepHammerspoonPath:
		s += checkStyle.Render("  ✓ Terminal: "+m.choice.Terminal) + "\n"
		s += checkStyle.Render("  ✓ Focus queue: enabled") + "\n\n"
		s += promptStyle.Render("? Where do you keep your Hammerspoon config?") + "\n\n"
		s += renderOptions(pathOptions, m.cursor)
	case stepCustomPath:
		s += checkStyle.Render("  ✓ Terminal: "+m.choice.Terminal) + "\n"
		s += checkStyle.Render("  ✓ Focus queue: enabled") + "\n\n"
		s += promptStyle.Render("? Enter your Hammerspoon config path:") + "\n\n"
		s += m.pathInput.View() + "\n"
	}

	s += "\n" + hintStyle.Render("  ↑↓ navigate • enter select • q quit") + "\n"

	return s
}
