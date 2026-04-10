package strutil

import "strings"

var polishReplacer = strings.NewReplacer(
	"ą", "a", "Ą", "a",
	"ć", "c", "Ć", "c",
	"ę", "e", "Ę", "e",
	"ł", "l", "Ł", "l",
	"ń", "n", "Ń", "n",
	"ó", "o", "Ó", "o",
	"ś", "s", "Ś", "s",
	"ź", "z", "Ź", "z",
	"ż", "z", "Ż", "z",
)

// NormalizeTag trims whitespace, lowercases, and replaces Polish diacritics
// with their ASCII equivalents.
func NormalizeTag(name string) string {
	return polishReplacer.Replace(strings.ToLower(strings.TrimSpace(name)))
}
