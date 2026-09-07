package cluster

import "testing"

func TestIsReadOnlyLabelValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "true lowercase", value: "true", want: true},
		{name: "true uppercase", value: "TRUE", want: true},
		{name: "true mixed case", value: "True", want: true},
		{name: "true with whitespace", value: "  true  ", want: true},
		{name: "empty string", value: "", want: false},
		{name: "false", value: "false", want: false},
		{name: "unrelated string", value: "yes", want: false},
		{name: "number", value: "1", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsReadOnlyLabelValue(tt.value)
			if got != tt.want {
				t.Errorf("IsReadOnlyLabelValue(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}
