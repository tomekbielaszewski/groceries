package strutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeTag(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Fruit", "fruit"},
		{"DAIRY", "dairy"},
		{"MixedCase", "mixedcase"},
		{"  fruit  ", "fruit"},
		{"ą", "a"},
		{"ć", "c"},
		{"ę", "e"},
		{"ł", "l"},
		{"ń", "n"},
		{"ó", "o"},
		{"ś", "s"},
		{"ź", "z"},
		{"ż", "z"},
		{"Ą", "a"},
		{"Ć", "c"},
		{"Ę", "e"},
		{"Ł", "l"},
		{"Ń", "n"},
		{"Ó", "o"},
		{"Ś", "s"},
		{"Ź", "z"},
		{"Ż", "z"},
		{"Słodycze", "slodycze"},
		{"Świeże Owoce", "swieze owoce"},
		{"ŻÓŁTY SER", "zolty ser"},
		{"nabiał", "nabial"},
		{"Mięso", "mieso"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, NormalizeTag(tt.input))
		})
	}
}
