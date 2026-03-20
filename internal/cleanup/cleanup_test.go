package cleanup

import (
	"testing"
)

func TestPlanEmpty(t *testing.T) {
	p := Plan{}
	if !p.Empty() {
		t.Error("expected empty plan")
	}

	p.Branches = []Item{{Kind: "branch", Name: "test"}}
	if p.Empty() {
		t.Error("expected non-empty plan")
	}
}

func TestPlanTotal(t *testing.T) {
	p := Plan{
		Worktrees: []Item{{}, {}},
		Branches:  []Item{{}},
		Sessions:  []Item{{}, {}, {}},
	}
	if p.Total() != 6 {
		t.Errorf("expected total 6, got %d", p.Total())
	}
}
