package main

import "testing"

func TestExpandHostlistQuery(t *testing.T) {
	got, ok := expandHostlistQuery("foo[01-03].bar", 25)
	if !ok {
		t.Fatalf("expected hostlist expansion")
	}
	want := []string{"foo01.bar", "foo02.bar", "foo03.bar"}
	if len(got) != len(want) {
		t.Fatalf("unexpected hostlist len: got=%d want=%d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected hostlist item %d: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestExpandHostlistQueryMultipleRanges(t *testing.T) {
	got, ok := expandHostlistQuery("rack[1-2]-node[7,9]", 10)
	if !ok {
		t.Fatalf("expected hostlist expansion")
	}
	want := []string{
		"rack1-node7",
		"rack1-node9",
		"rack2-node7",
		"rack2-node9",
	}
	if len(got) != len(want) {
		t.Fatalf("unexpected hostlist len: got=%d want=%d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected hostlist item %d: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestExpandHostlistQueryTruncatesOversizedExpansion(t *testing.T) {
	got, ok := expandHostlistQuery("n[1-30]", 25)
	if !ok {
		t.Fatalf("expected oversized hostlist to return truncated expansion")
	}
	if len(got) != 25 {
		t.Fatalf("unexpected truncated len: %d", len(got))
	}
	if got[0] != "n01" || got[24] != "n25" {
		t.Fatalf("unexpected truncated values: first=%q last=%q", got[0], got[24])
	}
}
